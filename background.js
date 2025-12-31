/**
 * Import utilities for service worker
 */
importScripts('utils.js', 'config.js');

/**
 * Initialize rate limiter - 10 requests per minute
 */
const apiRateLimiter = new RateLimiter(10, 60000);

/**
 * Call Vercel proxy with authentication
 * @param {Object} requestBody - The request body to send to Anthropic
 * @returns {Promise<Object>} Response from Anthropic via Vercel proxy
 */
async function callVercelProxy(requestBody) {
    // Get Gmail OAuth token for authentication
    const gmailToken = await getAuthToken();

    // Get Vercel API URL
    const apiUrl = CONFIG.getApiUrl();

    Logger.log('Calling Vercel proxy:', apiUrl);

    const response = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gmailToken}`
        },
        body: JSON.stringify(requestBody)
    }, 30000); // 30 second timeout

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
            // Token is invalid or expired - clear cache to force refresh
            await chrome.storage.local.remove(['gmailToken', 'gmailTokenExpiry']);
            const detailsStr = typeof errorData.details === 'object' ? JSON.stringify(errorData.details) : (errorData.details || '');
            const details = detailsStr ? ` (${detailsStr})` : '';
            const errorMessage = `Authentication failed: ${errorData.message || 'Unknown error'}${details}`;
            console.error('[Vercel Proxy Error] 401 Unauthorized:', errorMessage, errorData);
            throw new Error(`${errorMessage}. Please sign in to Gmail again.`);
        } else if (response.status === 402) {
            throw new Error(
                "Thank you for using our product. The limit on generations has been hit. Consider upgrading your plan."
            );
        } else if (response.status === 403) {
            throw new Error(
                `Your email is not authorized to use this extension. ` +
                `${errorData.email ? `Current email: ${errorData.email}. ` : ''}` +
                `Please contact your administrator for access.`
            );
        } else if (response.status === 500) {
            throw new Error(
                `Server error: ${errorData.message || 'Unknown error'}. ` +
                `Please contact your administrator.`
            );
        } else {
            throw new Error(
                `API error (${response.status}): ${errorData.message || 'Unknown error'}`
            );
        }
    }

    return response.json();
}

/**
 * Initialize logger
 */
(async () => {
    await Logger.init();
})();

// --- Web Grounding Helper ---
/**
 * Perform web search to find recent news about profile
 * @param {Object} profileData - LinkedIn profile data
 * @returns {Promise<string|null>} Recent news or null
 */
async function performWebSearch(profileData) {
    // Construct search query based on profile
    const company = profileData.experience?.split('\n')[0]?.split(' at ')[1]?.split('(')[0]?.trim();
    const name = profileData.name;

    if (!company || !name) {
        return null;
    }

    const searchQuery = `${name} ${company} news recent funding portfolio`;

    try {
        // Check rate limit
        await apiRateLimiter.checkLimit();

        const data = await callVercelProxy({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            messages: [{
                role: 'user',
                content: `Search for recent news about ${name} at ${company}. Focus on: funding rounds, new portfolio companies (if VC), product launches, or career moves. If nothing recent/relevant found, say "NO_RELEVANT_NEWS". Be very concise (2-3 sentences max).`
            }],
            tools: [{
                type: 'web_search_20241101'
            }]
        });
        if (data.error) {
            Logger.error('Web search error:', data.error);
            return null;
        }

        // Extract text from response
        const textContent = data.content?.find(c => c.type === 'text')?.text || '';

        // Check if no relevant news
        if (textContent.includes('NO_RELEVANT_NEWS') || textContent.length < 10) {
            return null;
        }

        return textContent;
    } catch (error) {
        Logger.error('Web search failed:', error);
        return null;
    }
}

/**
 * Message listener for extension communication
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateDraft') {
        handleGenerateDraft(request.data)
            .then(sendResponse)
            .catch((error) => {
                Logger.error('Generation failed:', error);
                const userMessage = formatErrorMessage(error);
                sendResponse({ success: false, error: userMessage });
            });
        return true; // Will respond asynchronously
    } else if (request.action === 'findEmail') {
        handleFindEmail(request.data)
            .then(sendResponse)
            .catch((error) => {
                Logger.error('Email lookup failed:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Will respond asynchronously
    }
});

/**
 * Handle email lookup request
 * @param {Object} requestData - Request data containing name and company
 * @returns {Promise<Object>} Email lookup result
 */
async function handleFindEmail(requestData) {
    try {
        // Check online status
        requireOnline();

        // Get Gmail token for auth
        const gmailToken = await getGmailToken();
        if (!gmailToken) {
            throw new Error('Authentication required. Please sign in first.');
        }

        // Check if Apollo is enabled
        const { apolloEnabled } = await chrome.storage.local.get('apolloEnabled');

        // Call Vercel API for email lookup
        const response = await fetchWithTimeout(`${CONFIG.VERCEL_API_URL}/api/find-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gmailToken}`
            },
            body: JSON.stringify({
                name: requestData.name,
                company: requestData.company,
                linkedinUrl: requestData.linkedinUrl,
                apolloEnabled: apolloEnabled || false
            })
        }, 15000); // 15 second timeout

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        Logger.log('Email lookup result:', data);

        return data;
    } catch (error) {
        Logger.error('Email lookup error:', error);
        throw error;
    }
}

/**
 * Handle draft generation request
 * @param {Object} requestData - Request data containing profile and settings
 * @returns {Promise<Object>} Generation result
 */
async function handleGenerateDraft(requestData) {
    try {
        // Check online status
        requireOnline();

        // Check rate limit
        await apiRateLimiter.checkLimit();

        let profileData = requestData.profile;
        const specialInstructions = requestData.instructions || '';
        let dynamicSenderName = requestData.senderName;
        const includeQuestions = requestData.includeQuestions || false;
        const useWebGrounding = requestData.useWebGrounding || false;

        const {
            userContext,
            senderName: storedSenderName,
            model = 'claude-sonnet-4-20250514',
            tone = 'Casual & Friendly',
            exampleEmail,
            generalInstructions = '',
            financeRecruitingMode = false,
            debugMode = false
        } = await chrome.storage.local.get(['userContext', 'senderName', 'model', 'tone', 'exampleEmail', 'generalInstructions', 'financeRecruitingMode', 'debugMode']);

        // Token counting and truncation to prevent exceeding model limits
        const originalTokens = estimateTokens(JSON.stringify(profileData));
        if (originalTokens > 3000) {
            Logger.warn(`Profile data has ${originalTokens} tokens, truncating to fit within limits`);
            profileData = truncateToTokenLimit(profileData, 3000);
        } else {
            Logger.log(`Profile data tokens: ${originalTokens}`);
        }

        const finalSenderName = dynamicSenderName || storedSenderName || 'Your Name';

        // All API calls now go through Vercel proxy (no local API key needed)

        // Debug mode logging
        if (debugMode) {
            Logger.log('=== DEBUG MODE ===');
            Logger.log('Profile Data:', profileData);
            Logger.log('Sender Name:', finalSenderName);
            Logger.log('User Context:', userContext);
            Logger.log('Model:', model);
            Logger.log('Tone:', tone);
            Logger.log('Finance Mode:', financeRecruitingMode);
        }

        // Sanitize general instructions (max 500 chars, strip dangerous patterns)
        let sanitizedInstructions = '';
        if (generalInstructions && generalInstructions.trim()) {
            sanitizedInstructions = generalInstructions.trim().substring(0, 500);
            // Remove potential prompt injection patterns
            sanitizedInstructions = sanitizedInstructions.replace(/system:/gi, '').replace(/assistant:/gi, '');
            if (debugMode) {
                Logger.log('General Instructions:', sanitizedInstructions);
            }
        }

        // Extract first name for signature
        const firstName = finalSenderName.split(' ')[0];

        // Perform web search if Web Grounding is enabled
        let webGroundingContext = null;
        if (useWebGrounding && model.startsWith('claude-')) {
            if (debugMode) {
                Logger.log('=== WEB GROUNDING ENABLED ===');
            }
            webGroundingContext = await performWebSearch(profileData);
            if (debugMode && webGroundingContext) {
                Logger.log('Web Grounding Result:', webGroundingContext);
            }
        }

        // Smart caching: Check for similar company+role pattern
        let cachedPattern = null;
        const extractCompanyRoleForLookup = (experience) => {
            if (!experience) return null;
            const firstLine = experience.split('\n')[0];
            const match = firstLine.match(/^(.+?)\s+at\s+(.+?)(?:\s+\(|$)/);
            if (match) {
                return {
                    role: match[1].trim(),
                    company: match[2].trim()
                };
            }
            return null;
        };

        const currentCompanyRole = extractCompanyRoleForLookup(profileData.experience);
        if (currentCompanyRole) {
            const cacheKey = `email_cache_${currentCompanyRole.company}_${currentCompanyRole.role}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            const { emailPatternCache = {} } = await chrome.storage.local.get('emailPatternCache');

            if (emailPatternCache[cacheKey] && emailPatternCache[cacheKey].expiresAt > Date.now()) {
                cachedPattern = emailPatternCache[cacheKey];
                if (debugMode) {
                    Logger.log('=== CACHED PATTERN FOUND ===');
                    Logger.log('Company:', cachedPattern.company);
                    Logger.log('Role:', cachedPattern.role);
                    Logger.log('Cached Subject:', cachedPattern.subject);
                }
            }
        }

        // Shared question formatting rules (used by both modes)
        const questionFormattingRules = `QUESTION FORMAT: Write intro line, then IMMEDIATELY start numbered list on the NEXT line with NO blank line. Each question on its own line with NO blank lines between questions. Correct format:
Two things I'm curious about:
1. First question here...
2. Second question here...

WRONG (do NOT do this):
Two things I'm curious about:

1. First question...

2. Second question...`;

        // Build Finance Recruiting specific instructions
        const financeInstructions = financeRecruitingMode ? `
      FINANCE MODE (${includeQuestions ? '125-150' : '100-125'} words):
      GOAL: Email so thoughtful they feel compelled to respond.

      ANALYSIS (use ALL profile data):
      - Use multiple specific details (roles, transitions, career trajectory)
      - Analyze patterns/pivots across their full career arc
      - Connect YOUR background to THEIRS analytically
      - STRONG OPENING: First sentence must grab attention with specific decision/transition. NO generic observations.
      - No fluff like "I came across your profile..." - jump to specific connection
      - SHOW RESEARCH, DON'T TELL: Never say "I did my research" or "impressed by your career". Just demonstrate it through specifics. No flattery.
      - DON'T recite their career history - only reference specifics as needed for connection
      - Ex: "Your move from [Company A] to [Company B] after only [X months] suggests you prioritized [Y]. I'm wrestling with similar decision..."

      STRUCTURE:
      1. Intro: Casual introduction with name, role, background (1 sentence). CRITICAL: ABSOLUTELY NO "Name here -" format (e.g., "Pranav here -"). Start directly with: "I'm [Name], [role/context]..."
      FORMATTING RULE: Do NOT include a salutation (e.g., "Hi Name") in the JSON body. Start directly with the first sentence.
      2. Connection: Find SPECIFIC points of intersection between YOUR journey and THEIRS. Make them think "this person really gets it."
      ${includeQuestions ? `3. Transition + 2-3 questions: "I wanted to ask for your advice:" then compact numbered list with NO blank lines. Questions must reference SPECIFIC details from their profile (companies, roles, transitions, timeframes).` : '3. Ask for a quick call'}
      4. Closing: Ask for a quick call (NOT "15 mins", just "quick call"). Acknowledge busy schedule, thank sincerely. NEVER offer coffee.

      SUBJECT: State your PURPOSE for reaching out (e.g., "Advice on moving from banking to operating", "Question about transitioning to growth equity"). NEVER just describe their career move (NOT "PWP to Duolingo Move"). Be formal/direct.
      TONE: Professional, respectful, intellectually curious. Show you did research.

      ${includeQuestions ? `QUESTIONS (2-3 only if highly relevant):
      - These questions are CRITICAL - they make your email engaging and hard to ignore
      - MUST reference SPECIFIC details: actual company names, specific role transitions, specific timeframes from their experience
      - FORBIDDEN: Generic questions that could apply to anyone. Questions MUST be rooted in their specific career arc
      - CURIOSITY OVER ANALYSIS: Ask with genuine curiosity, not armchair analysis. Don't psychoanalyze their motivations or make assumptions about why they did things.
      - NO GENERALIZATIONS: Never say "most people...", "typically X does Y", "people usually...". Don't position their choice against what "others" do.
      - NO ASSUMPTION STATEMENTS: Don't tell them what they "valued" or what their move "suggests". Just ask the question directly.
      - Ask about decisions/trade-offs using their ACTUAL experiences, NOT "what is it like"
      - Focus on CAREER and WORK decisions - NEVER mention compensation, comp, salary, or money
      - AVOID ASSUMPTIONS: Don't assume they're "ramping up" or "getting up to speed" unless they just started (<3 months). Check tenure carefully.
      - SENIORITY: Don't ask basic questions of senior people (MDs/Partners/VPs) - they expect depth and analytical thinking.
      Good: "What spurred the move to Sequoia at the 2.5 year mark vs staying for VP?" / "What made you confident in the timing for consumer VC?"
      Bad: "What's it like?" / "Any advice?" / "How did you get into [field]?" / "How's the new role going?" / "Most people I know..." / "Your sequencing suggests..." / Any vague question / Any mention of compensation/money` : ''}
      TIMING & PRECISION: Don't say "recently started/joined" unless <3 months ago. NEVER make assumptions about their current state (e.g., "swamped getting up to speed", "settling in", "ramping up") - you don't know this. Stick to facts from their profile.
      TONE: Always polite, respectful, and non-offensive. Never pushy or entitled.
      FORMAT: Use double line breaks (\n\n) ONLY between paragraphs/sections. NEVER wrap lines within paragraphs - each paragraph should flow as continuous text without mid-sentence line breaks${includeQuestions ? `, ${questionFormattingRules}` : ''}. Sign: "Best, ${firstName}"
        ` : '';

        // Build Question Mode instructions (for non-finance mode)
        const questionInstructions = includeQuestions ? `
      QUESTION MODE (1-3 questions):
      - CRITICAL: Questions make your email engaging and hard to ignore
      - MUST reference SPECIFIC details: actual company names, specific role transitions, specific timeframes from their experience
      - FORBIDDEN: Generic questions that could apply to anyone. Questions MUST be rooted in their specific career arc
      - CURIOSITY OVER ANALYSIS: Ask with genuine curiosity, not armchair analysis. Don't psychoanalyze their motivations or make assumptions about why they did things.
      - NO GENERALIZATIONS: Never say "most people...", "typically X does Y", "people usually...". Don't position their choice against what "others" do.
      - NO ASSUMPTION STATEMENTS: Don't tell them what they "valued" or what their move "suggests". Just ask the question directly.
      - Ask about decisions/trade-offs using their ACTUAL experiences, NOT "what is it like"
      - Focus on CAREER and WORK - NEVER mention compensation, comp, salary, or money
      - AVOID ASSUMPTIONS: Don't assume their current state (e.g., "ramping up", "settling in") unless they just started (<3 months)
      - SENIORITY: Don't ask basic questions of senior people (MDs/Partners/VPs) - they expect depth and analytical thinking.
      - Be concise, specific to THEIR journey. Skip if no highly pertinent question.
      ${questionFormattingRules}
      Good: "What spurred the move to a 20-person startup at the 4 year mark?" / "What made you confident in the timing for consumer VC?"
      Bad: "Pick your brain?" / "Any advice?" / "What's it like?" / "How's the new gig?" / "Most people I know..." / "Your sequencing suggests..." / Any vague question / Any mention of compensation` : '';

        const prompt = `${sanitizedInstructions ? `
===== USER'S GENERAL INSTRUCTIONS (HIGH PRIORITY - FOLLOW STRICTLY) =====
${sanitizedInstructions}
===== END GENERAL INSTRUCTIONS =====

` : ''}
      You're a real person writing a genuine cold email (NOT marketer/salesperson).

      CRITICAL RULES:
      1. NO "Name here -" format. Start: "I'm [Name], [role/context]..."
      2. Questions need SPECIFIC details (company names, roles, timeframes). NO generic questions.
      3. Don't assume current state ("swamped", "ramping up") unless factual.
      4. BE CONCISE: Don't recite career history. Max ONE specific detail per question.
      5. Use ACTUAL titles from their profile. Don't paraphrase.
      6. STRONG OPENING: Grab attention with specific decision/transition, not generic observations.
      7. SHOW research through specifics. Never say "I did research" or "impressed by career". No flattery.
      8. Questions under 25 words. Cut context, keep question.
      9. Questions reveal deep thought about career choices. Show analytical thinking, not surface curiosity.
      10. Adjust tone for seniority. Senior people (MDs/Partners/VPs) expect depth and intellectual engagement.
      11. FORBIDDEN: "buyside", "sellside", "sell-side", "buy-side". Use specific terms.
      12. NO PLACEHOLDERS: Never use brackets, variables, or placeholder text like "$XXM+", "$[amount]", "[X years]", etc. Only use concrete facts from the profile. If you don't know a specific number, omit it entirely or rephrase without it.
      12. NO SPECIAL CHARACTERS: Never use arrows (→), bullets (•), em-dashes (—), or Unicode symbols. Use only standard ASCII: hyphens (-), asterisks (*), regular quotes.

      RECIPIENT:
      Name: ${profileData.name}
      Headline: ${profileData.headline}
      ${profileData.location ? `Location: ${profileData.location}` : ''}
      ${profileData.connectionsCount ? `Connections: ${profileData.connectionsCount}` : ''}
      ${profileData.followersCount ? `Followers: ${profileData.followersCount}` : ''}

      About: ${profileData.about}

      Experience: ${profileData.experience}

      ${profileData.education ? `Education: ${profileData.education}` : ''}
      ${profileData.skills ? `Skills: ${profileData.skills}` : ''}
      ${profileData.languages ? `Languages: ${profileData.languages}` : ''}
      ${profileData.certifications ? `Certifications:\n${profileData.certifications}` : ''}
      ${profileData.courses ? `Courses: ${profileData.courses}` : ''}
      ${profileData.testScores ? `Test Scores: ${profileData.testScores}` : ''}
      ${profileData.volunteer ? `Volunteer Experience:\n${profileData.volunteer}` : ''}
      ${profileData.awards ? `Honors & Awards:\n${profileData.awards}` : ''}
      ${profileData.projects ? `Projects: ${profileData.projects}` : ''}
      ${profileData.publications ? `Publications:\n${profileData.publications}` : ''}
      ${profileData.patents ? `Patents:\n${profileData.patents}` : ''}
      ${profileData.organizations ? `Organizations:\n${profileData.organizations}` : ''}
      ${profileData.interests ? `Interests: ${profileData.interests}` : ''}
      ${profileData.featured ? `Featured Content: ${profileData.featured}` : ''}
      ${profileData.recommendations ? `Recommendations:\n${profileData.recommendations}` : ''}
      ${profileData.recentActivity ? `Recent Activity:\n${profileData.recentActivity}` : ''}
      ${profileData.contactWebsite ? `Website: ${profileData.contactWebsite}` : ''}
      ${profileData.contactTwitter ? `Twitter: ${profileData.contactTwitter}` : ''}

      Analyze FULL career trajectory (patterns, transitions), not just current role. Use ALL available information to find unique connection points.

      SENDER: ${userContext || 'Not provided'}

      ${webGroundingContext ? `RECENT NEWS: ${webGroundingContext}\n\nUse only if creates genuine connection. NEVER force it.` : ''}

      CTA: ALWAYS ask for quick call. NEVER offer coffee or specify duration.

      ${!includeQuestions ? 'CRITICAL: Do NOT include questions in this email. Skip questions entirely and go straight to asking for a quick call.' : ''}

      ${specialInstructions ? `SPECIAL: ${specialInstructions}` : ''}
      ${exampleEmail ? `STYLE REF (for tone/style only, NOT structure): ${exampleEmail}${!includeQuestions ? ' - NOTE: Do NOT copy questions from this example. This email should NOT include questions.' : ''}` : ''}

      WARM CONNECTION: If known (mentor/colleague/met), reconnect naturally. Don't explain relationship.

      SPARSE PROFILE: If limited data, focus on what exists, keep shorter.

      ${financeInstructions}

      ${questionInstructions}

      TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
      GOAL: Make email engaging and hard to ignore. Find specific connections. Ask questions they're uniquely positioned to answer based on their career trajectory.

      Write like a human (no jargon, natural).

      ${financeRecruitingMode ? '' : `CASUAL MODE:
      1. Use ALL experiences - find pivots/patterns. DON'T recite career history.
      2. Short punchy sentences. Conversational but professional.
      3. NO "Name here -" format. Start: "I'm [Name], [role/context]..."
      4. First sentence grabs attention with specific decision/transition.
      5. Find SPECIFIC connection points (company names, roles, timeframes). Make them want to talk.
      6. Show research through specifics. No flattery.
      7. CTA: Quick call. NOT "15-min". NEVER coffee. Acknowledge busy schedule.
      8. Polite, respectful, genuine. Adjust for seniority.
      9. NEVER mention compensation/money.
      10. Don't assume current state. Stick to profile facts.
      11. Use exact job titles from LinkedIn.
      `}

      ${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
      SUBJECT: MUST be about YOU (the sender), NOT the recipient. Format: Your background/credentials + what you're seeking (general). Include sender's notable position/background to increase response likelihood. Examples: "GS Analyst Seeking Advice on Founding Experience", "McKinsey Consultant Exploring Tech Transitions", "Yale Student Interested in Banking to PE Path", "Former Founder Exploring Operating Roles". Keep it GENERAL about your interest area, NOT specific questions. NEVER about recipient's career ("Your move to X", "Career at Y"). Never generic: "Quick Question"/"Reaching Out"/"Coffee?"`}

      FORMAT: ${financeRecruitingMode ? (includeQuestions ? '125-150' : '100-125') : (includeQuestions ? '125-150' : '75-100')} words. CRITICAL LINE BREAK RULE: Each paragraph MUST be written as ONE continuous flowing block of text. Do NOT insert line breaks or newlines within a paragraph. ONLY use double line breaks (\n\n) to separate different paragraphs. A paragraph should read naturally as a single text block without any internal breaks, even if it's multiple sentences long. Standard ASCII only - ABSOLUTELY NO special characters like arrows (→), bullets (•), em-dashes (—), or any Unicode symbols. Use regular hyphens (-), asterisks (*), and standard punctuation only. NEVER use placeholders like "$XXM+", "[X amount]", or bracket notation. Only state concrete facts. JSON: {"subject": "...", "body": "..."} (NO "Hi [Name]" in body).
      ALMA MATER: Only mention school if sender attended SAME one.
    `;

        // Debug logging for prompt
        if (debugMode) {
            Logger.log('=== FULL PROMPT ===');
            Logger.log(prompt);
            Logger.log('==================');
        }

        let content;

        // --- ANTHROPIC / CLAUDE API CALL ---
        if (model.startsWith('claude-')) {
            // NOTE: We do NOT need an API key for Claude anymore; it's handled by the Vercel proxy.

            // Split prompt into cacheable (static instructions) and dynamic (profile data)
            const staticInstructions = `${sanitizedInstructions ? `===== USER'S GENERAL INSTRUCTIONS (HIGH PRIORITY - FOLLOW STRICTLY) =====
${sanitizedInstructions}
===== END GENERAL INSTRUCTIONS =====

` : ''}You're a real person writing a genuine cold email (NOT marketer/salesperson).

CRITICAL RULES:
1. BODY: NO "Hi [Name]" in JSON body. Start with first sentence.
2. NO "Name here -" format. Start: "I'm [Name], [role/context]..."
3. Questions need SPECIFIC details (company names, roles, timeframes). NO generic questions.
4. Don't assume current state ("swamped", "ramping up") unless factual.
5. BE CONCISE: Don't recite career history. Reference specifics only as needed.
6. Use ACTUAL titles from profile. Don't paraphrase.
7. STRONG OPENING: Grab attention with specific decision/transition, not generic observations.
8. SHOW research through specifics. Never say "I did research" or "impressed by career". No flattery.
9. Questions reveal deep thought about career choices. Show analytical thinking, not surface curiosity.
10. Adjust tone for seniority. Senior people (MDs/Partners/VPs) expect depth and intellectual engagement.
11. FORMATTING: Keep paragraphs SHORT (2-3 sentences max). Use double line breaks (\n\n) ONLY between paragraphs. NEVER wrap lines within paragraphs - let each paragraph flow naturally as a single block of text. Do not insert line breaks in the middle of sentences.
12. NO PLACEHOLDERS: Never use brackets, variables, or placeholder text like "$XXM+", "$[amount]", "[X years]", etc. Only use concrete facts from the profile. If you don't know a specific number, omit it entirely or rephrase without it.
13. NO SPECIAL CHARACTERS: Never use arrows (→), bullets (•), em-dashes (—), or Unicode symbols. Use only standard ASCII: hyphens (-), asterisks (*), regular quotes.

CTA: ALWAYS ask for quick call. NEVER offer coffee or specify duration.

${!includeQuestions ? 'CRITICAL: Do NOT include questions in this email. Skip questions entirely and go straight to asking for a quick call.' : ''}

WARM CONNECTION: If known (mentor/colleague/met), reconnect naturally. Don't explain relationship.

SPARSE PROFILE: If limited data, focus on what exists, keep shorter.

${financeInstructions}

${questionInstructions}

TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
GOAL: Make email engaging and hard to ignore. Find specific connections. Ask questions they're uniquely positioned to answer.

Write like a human (no jargon, natural).

${financeRecruitingMode ? '' : `CASUAL MODE:
1. Use ALL experiences - find pivots/patterns. DON'T recite career history.
2. Short punchy sentences. Conversational but professional.
3. NO "Name here -" format. Start: "I'm [Name], [role/context]..."
4. First sentence grabs attention with specific decision/transition.
5. Find SPECIFIC connection points (company names, roles, timeframes). Make them want to talk.
6. Show research through specifics. No flattery.
7. CTA: Quick call. NOT "15-min". NEVER coffee. Acknowledge busy schedule.
8. Polite, respectful, genuine. Adjust for seniority.
9. NEVER mention compensation/money.
10. Don't assume current state. Stick to profile facts.
11. Use exact job titles from LinkedIn.
`}

${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
SUBJECT: MUST be about YOU (the sender), NOT the recipient. Format: Your background/credentials + what you're seeking (general). Include sender's notable position/background to increase response likelihood. Examples: "GS Analyst Seeking Advice on Founding Experience", "McKinsey Consultant Exploring Tech Transitions", "Yale Student Interested in Banking to PE Path", "Former Founder Exploring Operating Roles". Keep it GENERAL about your interest area, NOT specific questions. NEVER about recipient's career ("Your move to X", "Career at Y"). Never generic: "Quick Question"/"Reaching Out"/"Coffee?"`}

FORMAT: ${financeRecruitingMode ? (includeQuestions ? '125-150' : '100-125') : (includeQuestions ? '125-150' : '75-100')} words. CRITICAL LINE BREAK RULE: Each paragraph MUST be written as ONE continuous flowing block of text. Do NOT insert line breaks or newlines within a paragraph. ONLY use double line breaks (\n\n) to separate different paragraphs. A paragraph should read naturally as a single text block without any internal breaks, even if it's multiple sentences long. Standard ASCII only - ABSOLUTELY NO special characters like arrows (→), bullets (•), em-dashes (—), or any Unicode symbols. Use regular hyphens (-), asterisks (*), and standard punctuation only. NEVER use placeholders like "$XXM+", "[X amount]", or bracket notation. Only state concrete facts. JSON: {"subject": "...", "body": "..."}
ALMA MATER: Only mention school if sender attended SAME one.`;

            const dynamicContent = `RECIPIENT:
Name: ${profileData.name}
Headline: ${profileData.headline}
${profileData.location ? `Location: ${profileData.location}` : ''}
${profileData.connectionsCount ? `Connections: ${profileData.connectionsCount}` : ''}
${profileData.followersCount ? `Followers: ${profileData.followersCount}` : ''}

About: ${profileData.about}

Experience: ${profileData.experience}

${profileData.education ? `Education: ${profileData.education}` : ''}
${profileData.skills ? `Skills: ${profileData.skills}` : ''}
${profileData.languages ? `Languages: ${profileData.languages}` : ''}
${profileData.certifications ? `Certifications:\n${profileData.certifications}` : ''}
${profileData.courses ? `Courses: ${profileData.courses}` : ''}
${profileData.testScores ? `Test Scores: ${profileData.testScores}` : ''}
${profileData.volunteer ? `Volunteer Experience:\n${profileData.volunteer}` : ''}
${profileData.awards ? `Honors & Awards:\n${profileData.awards}` : ''}
${profileData.projects ? `Projects: ${profileData.projects}` : ''}
${profileData.publications ? `Publications:\n${profileData.publications}` : ''}
${profileData.patents ? `Patents:\n${profileData.patents}` : ''}
${profileData.organizations ? `Organizations:\n${profileData.organizations}` : ''}
${profileData.interests ? `Interests: ${profileData.interests}` : ''}
${profileData.featured ? `Featured Content: ${profileData.featured}` : ''}
${profileData.recommendations ? `Recommendations:\n${profileData.recommendations}` : ''}
${profileData.recentActivity ? `Recent Activity:\n${profileData.recentActivity}` : ''}
${profileData.contactWebsite ? `Website: ${profileData.contactWebsite}` : ''}
${profileData.contactTwitter ? `Twitter: ${profileData.contactTwitter}` : ''}

Analyze FULL career trajectory (patterns, transitions), not just current role. Use ALL available information to find unique connection points.

SENDER: ${userContext || 'Not provided'}

${webGroundingContext ? `RECENT NEWS: ${webGroundingContext}\n\nUse only if creates genuine connection. NEVER force it.` : ''}

${specialInstructions ? `SPECIAL: ${specialInstructions}` : ''}
${exampleEmail ? `STYLE REF: ${exampleEmail}` : ''}
${cachedPattern ? `\n\nSUCCESSFUL PATTERN (${cachedPattern.role} at ${cachedPattern.company}):\nSubject: ${cachedPattern.subject}\nBody (adapt, don't copy): ${cachedPattern.body.substring(0, 200)}...` : ''}`;

            const data = await callVercelProxy({
                model: model,
                max_tokens: 1024,
                system: [
                    {
                        type: "text",
                        text: "You are a helpful assistant that outputs only JSON.",
                        cache_control: { type: "ephemeral" }
                    },
                    {
                        type: "text",
                        text: staticInstructions,
                        cache_control: { type: "ephemeral" }
                    }
                ],
                messages: [{ role: "user", content: dynamicContent }]
            });
            if (data.error) {
                throw new Error(data.error.message);
            }
            content = data.content[0].text;
        }
        // --- OPENAI API CALL (via Vercel proxy) ---
        else {
            const data = await callVercelProxy({
                model: model,
                max_tokens: 1024,
                system: "You are a helpful assistant that outputs only JSON.",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            });

            if (data.error) {
                throw new Error(data.error.message);
            }
            content = data.choices[0].message.content;
        }

        let emailDraft;
        try {
            // Remove markdown code blocks if present (common with Claude)
            let cleanContent = content.trim();

            // Remove ```json\n and \n``` markers (with newlines)
            cleanContent = cleanContent.replace(/^```json\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
            // Also handle plain ``` markers
            cleanContent = cleanContent.replace(/^```\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

            emailDraft = JSON.parse(cleanContent.trim());
        } catch (e) {
            Logger.warn('JSON parsing failed, using raw content:', e);
            emailDraft = { subject: "Intro", body: content };
        }

        // ENFORCE SALUTATION
        if (profileData.name) {
            const recipientFirst = profileData.name.trim().split(' ')[0];
            // Remove existing salutation if model ignored instructions
            let body = emailDraft.body.trim();
            // Match and remove greetings like "Hi Name,", "Hello Name", "Dear Name,\n\n" etc.
            body = body.replace(/^(Hi|Hello|Dear)\s+[^,\n]+,?\s*(\n\n?)?/i, '');
            emailDraft.body = `Hi ${recipientFirst},\n\n${body}`;
        }

        // ENFORCE SIGNATURE
        // Ensure "Best, [Sender]" is always at the end
        const explicitSenderName = storedSenderName || 'Pranav'; // Fallback for debugging if needed, though storedSenderName should be there
        if (explicitSenderName) {
            let body = emailDraft.body.trim();

            // Remove existing signatures (Best, Regards, Cheers, etc.) followed by name or end of string
            // Regex handles:
            // 1. "Best,\nName"
            // 2. "Best,\n" (trailing)
            // 3. "Best," (end of string)
            const signatureRegex = /\n\n(Best|Regards|Sincerely|Thanks|Cheers|Warmly),?\s*([^\n]*)?$/i;
            body = body.replace(signatureRegex, '');

            // Also handle just the name if it's the last line
            const nameRegex = new RegExp(`\\n\\n${explicitSenderName}$`, 'i');
            body = body.replace(nameRegex, '');

            // Append standardized signature
            emailDraft.body = `${body.trim()}\n\nBest,\n${explicitSenderName}`;
        }

        // Debug logging for generated draft
        if (debugMode) {
            Logger.log('=== GENERATED DRAFT ===');
            Logger.log('Subject:', emailDraft.subject);
            Logger.log('Body:', emailDraft.body);
            Logger.log('====================');
        }

        // --- EMAIL PREDICTION LOGIC ---
        let predictedEmail = null;
        let predictedBcc = null;

        // Helper function to parse email format templates
        const parseEmailFormat = (template, first, last) => {
            if (!template) return null;
            return template
                .replace('{first}', first)
                .replace('{last}', last)
                .replace('{f}', first[0])
                .replace('{first_initial}', first[0])
                .replace('{l}', last[0])
                .replace('{last_initial}', last[0]);
        };

        // Fuzzy company name matcher with strict validation
        const fuzzyMatchCompany = (profileCompany, dbCompany) => {
            const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tokenize = (str) => str.toLowerCase().split(/[\s\-_.,&()]+/).filter(t => t.length > 0);

            const pCompanyNorm = normalize(profileCompany);
            const dCompanyNorm = normalize(dbCompany);

            // Exact match (normalized)
            if (pCompanyNorm === dCompanyNorm) return 100;

            // Length similarity check - prevent matching vastly different company names
            const lengthRatio = Math.min(pCompanyNorm.length, dCompanyNorm.length) /
                Math.max(pCompanyNorm.length, dCompanyNorm.length);

            // If lengths are too different (e.g., "Google" vs "Point72"), heavily penalize
            if (lengthRatio < 0.5) return 0;

            // Levenshtein distance for similarity scoring
            const levenshtein = (a, b) => {
                const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
                for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
                for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

                for (let j = 1; j <= b.length; j++) {
                    for (let i = 1; i <= a.length; i++) {
                        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                        matrix[j][i] = Math.min(
                            matrix[j][i - 1] + 1,
                            matrix[j - 1][i] + 1,
                            matrix[j - 1][i - 1] + indicator
                        );
                    }
                }
                return matrix[b.length][a.length];
            };

            // Calculate Levenshtein similarity
            const distance = levenshtein(pCompanyNorm, dCompanyNorm);
            const maxLen = Math.max(pCompanyNorm.length, dCompanyNorm.length);
            const levenshteinScore = ((maxLen - distance) / maxLen) * 100;

            // Contains match - but only if it's a meaningful substring (not just 2-3 chars)
            const containsMatch = (pCompanyNorm.includes(dCompanyNorm) && dCompanyNorm.length >= 4) ||
                (dCompanyNorm.includes(pCompanyNorm) && pCompanyNorm.length >= 4);
            if (containsMatch) return Math.max(90, levenshteinScore);

            // Token-based matching with stricter criteria
            const pTokens = tokenize(profileCompany);
            const dTokens = tokenize(dbCompany);

            // Require meaningful tokens (at least 2 characters)
            const meaningfulPTokens = pTokens.filter(t => t.length >= 2);
            const meaningfulDTokens = dTokens.filter(t => t.length >= 2);

            if (meaningfulDTokens.length === 0) return levenshteinScore;

            // Exact token matches only (no partial matches for stricter validation)
            const exactTokenMatches = meaningfulDTokens.filter(dt =>
                meaningfulPTokens.some(pt => pt === dt)
            ).length;

            // Check if all db tokens match exactly (handles "J.P. Morgan" vs "JPMorgan" when normalized)
            const allDbTokensMatch = meaningfulDTokens.every(dt =>
                meaningfulPTokens.some(pt => pt === dt || normalize(pt) === normalize(dt))
            );

            if (allDbTokensMatch && meaningfulDTokens.length > 0) {
                return Math.max(85, levenshteinScore);
            }

            // Calculate token overlap score - require at least 60% exact matches
            const tokenOverlap = exactTokenMatches / meaningfulDTokens.length;
            if (tokenOverlap < 0.6) return Math.min(levenshteinScore, 50);

            // Penalize if there are mismatched tokens in the database company name
            const tokenScore = tokenOverlap * 75;

            // Return the best score from Levenshtein or token matching
            return Math.max(levenshteinScore, tokenScore);
        };

        if (profileData.experience && profileData.name) {
            // Comprehensive company email format database
            const COMPANY_EMAIL_FORMATS = [
                // AI & Deep Tech
                { "company": "Safe Superintelligence", "format": "{first}@ssi.inc", "alt": "{first}{last}@ssi.inc" },
                { "company": "SSI", "format": "{first}@ssi.inc", "alt": "{first}{last}@ssi.inc" },
                { "company": "Anthropic", "format": "{first}@anthropic.com", "alt": "{f}{last}@anthropic.com" },
                { "company": "OpenAI", "format": "{f}{last}@openai.com", "alt": "{first}@openai.com" },
                { "company": "Mistral AI", "format": "{first}@mistral.ai", "alt": "{f}{last}@mistral.ai" },
                { "company": "Mistral", "format": "{first}@mistral.ai", "alt": "{f}{last}@mistral.ai" },
                { "company": "Perplexity", "format": "{first}@perplexity.ai", "alt": "{first}.{last}@perplexity.ai" },
                { "company": "Cohere", "format": "{first}@cohere.com", "alt": "{first}@cohere.ai" },
                { "company": "Midjourney", "format": "{f}{last}@midjourney.com", "alt": "{first}@midjourney.com" },
                { "company": "Black Forest Labs", "format": "{first}@blackforestlabs.ai", "alt": "" },
                { "company": "World Labs", "format": "{first}@worldlabs.ai", "alt": "" },
                { "company": "Poolside", "format": "{first}@poolside.ai", "alt": "" },
                { "company": "Hugging Face", "format": "{first}@huggingface.co", "alt": "" },
                { "company": "Scale AI", "format": "{first}.{last}@scale.com", "alt": "{first}@scale.com" },
                { "company": "Scale", "format": "{first}.{last}@scale.com", "alt": "{first}@scale.com" },
                { "company": "Shield AI", "format": "{first}.{last}@shield.ai", "alt": "" },
                { "company": "Databricks", "format": "{first}.{last}@databricks.com", "alt": "{first}@databricks.com" },
                { "company": "Glean", "format": "{first}.{last}@glean.com", "alt": "{first}@glean.com" },
                { "company": "Jasper", "format": "{first}.{last}@jasper.ai", "alt": "" },
                { "company": "RunwayML", "format": "{first}@runwayml.com", "alt": "" },
                { "company": "Runway", "format": "{first}@runwayml.com", "alt": "" },
                { "company": "Deepgram", "format": "{first}.{last}@deepgram.com", "alt": "" },
                { "company": "Seven AI", "format": "{first}@seven.ai", "alt": "" },
                { "company": "Together AI", "format": "{first}@together.ai", "alt": "" },
                { "company": "Together", "format": "{first}@together.ai", "alt": "" },
                { "company": "IonQ", "format": "{first}.{last}@ionq.com", "alt": "" },
                { "company": "Sandbox AQ", "format": "{first}.{last}@sandboxaq.com", "alt": "" },
                { "company": "Decagon", "format": "{first}@decagon.ai", "alt": "" },
                { "company": "Writer", "format": "{first}@writer.com", "alt": "{first}.{last}@writer.com" },
                { "company": "ElevenLabs", "format": "{first}@elevenlabs.io", "alt": "" },
                { "company": "Abridge", "format": "{last}{f}@abridge.com", "alt": "{first}@abridge.com" },
                { "company": "Anduril", "format": "{first}@anduril.com", "alt": "{last}@anduril.com" },
                { "company": "Applied Intuition", "format": "{f}{last}@appliedintuition.com", "alt": "" },
                { "company": "Cognition", "format": "{first}@cognition.ai", "alt": "" },
                { "company": "Fireworks AI", "format": "{first}@fireworks.ai", "alt": "" },
                { "company": "Fireworks", "format": "{first}@fireworks.ai", "alt": "" },
                { "company": "Harvey", "format": "{first}@harvey.ai", "alt": "" },
                { "company": "Mercor", "format": "{first}{last}@mercor.com", "alt": "" },
                { "company": "Sierra", "format": "{first}@sierra.ai", "alt": "" },
                { "company": "Statsig", "format": "{first}@statsig.com", "alt": "" },
                { "company": "Surge AI", "format": "{first}@surgehq.ai", "alt": "" },
                { "company": "Thinking Machines", "format": "{first}@thinkingmachines.ai", "alt": "" },
                { "company": "Turing", "format": "{first}.{last}@turing.com", "alt": "" },
                { "company": "LlamaIndex", "format": "{first}@llamaindex.ai", "alt": "" },
                { "company": "LangChain", "format": "{f}{last}@langchain.com", "alt": "" },
                { "company": "Patronus AI", "format": "{first}@patronus.ai", "alt": "" },
                { "company": "Patronus", "format": "{first}@patronus.ai", "alt": "" },
                { "company": "Sakana AI", "format": "{first}@sakana.ai", "alt": "" },
                { "company": "Sakana", "format": "{first}@sakana.ai", "alt": "" },
                { "company": "SambaNova", "format": "{first}.{last}@sambanova.ai", "alt": "" },
                { "company": "Snorkel", "format": "{first}@snorkel.ai", "alt": "" },
                { "company": "Synthesia", "format": "{first}.{last}@synthesia.io", "alt": "" },
                { "company": "Tonic", "format": "{first}@tonic.ai", "alt": "" },
                { "company": "Unstructured", "format": "{first}@unstructured.io", "alt": "" },
                { "company": "Anyscale", "format": "{first}@anyscale.com", "alt": "" },
                { "company": "Arize", "format": "{first}@arize.com", "alt": "" },
                { "company": "Baseten", "format": "{first}@baseten.co", "alt": "" },
                { "company": "Fiddler", "format": "{first}@fiddler.ai", "alt": "" },
                { "company": "Lightning AI", "format": "{first}@lightning.ai", "alt": "" },
                { "company": "Lightning", "format": "{first}@lightning.ai", "alt": "" },
                { "company": "Modular", "format": "{first}@modular.com", "alt": "" },
                { "company": "Pinecone", "format": "{first}@pinecone.io", "alt": "" },

                // DevTools & Infra
                { "company": "Vercel", "format": "{first}.{last}@vercel.com", "alt": "{first}@vercel.com" },
                { "company": "Replit", "format": "{first}@replit.com", "alt": "{first}@repl.it" },
                { "company": "Supabase", "format": "{first}@supabase.com", "alt": "{first}@supabase.io" },
                { "company": "Cursor", "format": "{first}@cursor.so", "alt": "{first}@cursor.com" },
                { "company": "Anysphere", "format": "{first}@cursor.so", "alt": "{first}@anysphere.co" },
                { "company": "Lovable", "format": "{first}@lovable.dev", "alt": "" },
                { "company": "Warp", "format": "{first}@warp.dev", "alt": "" },
                { "company": "ClickUp", "format": "{f}{last}@clickup.com", "alt": "" },
                { "company": "Grafana Labs", "format": "{first}.{last}@grafana.com", "alt": "" },
                { "company": "Grafana", "format": "{first}.{last}@grafana.com", "alt": "" },
                { "company": "Confluent", "format": "{first}.{last}@confluent.io", "alt": "" },
                { "company": "HashiCorp", "format": "{first}.{last}@hashicorp.com", "alt": "" },
                { "company": "Docker", "format": "{first}.{last}@docker.com", "alt": "" },
                { "company": "PostHog", "format": "{first}@posthog.com", "alt": "" },
                { "company": "Sentry", "format": "{first}.{last}@sentry.io", "alt": "" },
                { "company": "Kong", "format": "{first}@konghq.com", "alt": "" },
                { "company": "MinIO", "format": "{first}@min.io", "alt": "" },
                { "company": "Redis", "format": "{first}.{last}@redis.com", "alt": "" },
                { "company": "MongoDB", "format": "{first}.{last}@mongodb.com", "alt": "" },
                { "company": "Elastic", "format": "{first}.{last}@elastic.co", "alt": "" },
                { "company": "Twilio", "format": "{first}.{last}@twilio.com", "alt": "" },
                { "company": "Cloudflare", "format": "{f}{last}@cloudflare.com", "alt": "{first}@cloudflare.com" },
                { "company": "Groq", "format": "{f}{last}@groq.com", "alt": "" },
                { "company": "CoreWeave", "format": "{f}{last}@coreweave.com", "alt": "{first}@coreweave.com" },
                { "company": "Lambda Labs", "format": "{first}@lambdalabs.com", "alt": "" },
                { "company": "Vast Data", "format": "{first}@vastdata.com", "alt": "" },
                { "company": "Vast", "format": "{first}@vastdata.com", "alt": "" },
                { "company": "Anaconda", "format": "{f}{last}@anaconda.com", "alt": "" },
                { "company": "Augment Code", "format": "{first}@augmentcode.com", "alt": "" },
                { "company": "Augment", "format": "{first}@augmentcode.com", "alt": "" },
                { "company": "Clay", "format": "{first}.{last}@clay.com", "alt": "{first}@clay.run" },
                { "company": "Cline", "format": "{first}@cline.bot", "alt": "" },
                { "company": "Crusoe", "format": "{f}{last}@crusoeenergy.com", "alt": "{first}@crusoe.ai" },
                { "company": "Framer", "format": "{first}@framer.com", "alt": "" },
                { "company": "MotherDuck", "format": "{first}@motherduck.com", "alt": "" },
                { "company": "n8n", "format": "{first}@n8n.io", "alt": "" },
                { "company": "Sourcegraph", "format": "{first}@sourcegraph.com", "alt": "" },
                { "company": "StackBlitz", "format": "{first}@stackblitz.com", "alt": "" },
                { "company": "Tines", "format": "{f}{last}@tines.com", "alt": "" },
                { "company": "ClickHouse", "format": "{first}@clickhouse.com", "alt": "" },
                { "company": "Cribl", "format": "{f}{last}@cribl.io", "alt": "" },
                { "company": "DBT Labs", "format": "{first}.{last}@dbtlabs.com", "alt": "" },
                { "company": "dbt Labs", "format": "{first}.{last}@dbtlabs.com", "alt": "" },
                { "company": "Fivetran", "format": "{first}.{last}@fivetran.com", "alt": "" },
                { "company": "Harness", "format": "{first}.{last}@harness.io", "alt": "" },
                { "company": "Lightmatter", "format": "{first}.{last}@lightmatter.co", "alt": "" },
                { "company": "Sonar", "format": "{first}.{last}@sonarsource.com", "alt": "" },
                { "company": "Substrate", "format": "{first}@substrate.run", "alt": "" },
                { "company": "Temporal", "format": "{first}.{last}@temporal.io", "alt": "" },
                { "company": "Boomi", "format": "{first}.{last}@boomi.com", "alt": "" },
                { "company": "New Relic", "format": "{first}.{last}@newrelic.com", "alt": "" },
                { "company": "OutSystems", "format": "{first}.{last}@outsystems.com", "alt": "" },
                { "company": "Qumulo", "format": "{first}.{last}@qumulo.com", "alt": "" },
                { "company": "Rescale", "format": "{first}.{last}@rescale.com", "alt": "" },
                { "company": "Spectro Cloud", "format": "{first}.{last}@spectrocloud.com", "alt": "" },
                { "company": "Chainguard", "format": "{first}@chainguard.dev", "alt": "" },
                { "company": "Fal", "format": "{first}@fal.ai", "alt": "" },
                { "company": "Seven", "format": "{first}@seven.ai", "alt": "" },
                { "company": "Unity", "format": "{first}.{last}@unity3d.com", "alt": "" },
                { "company": "NetApp", "format": "{first}.{last}@netapp.com", "alt": "" },
                { "company": "Nutanix", "format": "{first}.{last}@nutanix.com", "alt": "" },
                { "company": "MuleSoft", "format": "{first}.{last}@mulesoft.com", "alt": "" },
                { "company": "Redgate", "format": "{first}.{last}@red-gate.com", "alt": "" },
                { "company": "Rubrik", "format": "{first}.{last}@rubrik.com", "alt": "" },
                { "company": "SUSE", "format": "{first}.{last}@suse.com", "alt": "" },
                { "company": "Canonical", "format": "{first}.{last}@canonical.com", "alt": "" },

                // Cybersecurity
                { "company": "CrowdStrike", "format": "{first}.{last}@crowdstrike.com", "alt": "" },
                { "company": "Palo Alto Networks", "format": "{f}{last}@paloaltonetworks.com", "alt": "" },
                { "company": "Zscaler", "format": "{first}.{last}@zscaler.com", "alt": "" },
                { "company": "Wiz", "format": "{first}.{last}@wiz.io", "alt": "" },
                { "company": "Snyk", "format": "{first}.{last}@snyk.io", "alt": "" },
                { "company": "Darktrace", "format": "{first}.{last}@darktrace.com", "alt": "" },
                { "company": "Arctic Wolf", "format": "{first}.{last}@arcticwolf.com", "alt": "" },
                { "company": "KnowBe4", "format": "{first}{l}@knowbe4.com", "alt": "" },
                { "company": "Abnormal Security", "format": "{f}{last}@abnormalsecurity.com", "alt": "" },
                { "company": "Abnormal", "format": "{f}{last}@abnormalsecurity.com", "alt": "" },
                { "company": "Huntress", "format": "{first}.{last}@huntress.com", "alt": "" },
                { "company": "Tanium", "format": "{first}.{last}@tanium.com", "alt": "" },
                { "company": "SentinelOne", "format": "{first}.{last}@sentinelone.com", "alt": "" },
                { "company": "Vanta", "format": "{first}.{last}@vanta.com", "alt": "" },
                { "company": "CyberArk", "format": "{first}.{last}@cyberark.com", "alt": "" },
                { "company": "Okta", "format": "{first}.{last}@okta.com", "alt": "" },
                { "company": "Nord Security", "format": "{first}.{last}@nordsec.com", "alt": "" },
                { "company": "1Password", "format": "{first}.{last}@1password.com", "alt": "" },
                { "company": "Everfox", "format": "{first}.{last}@everfox.com", "alt": "" },
                { "company": "Coalition", "format": "{first}@coalitioninc.com", "alt": "" },
                { "company": "Torq", "format": "{first}.{last}@torq.io", "alt": "" },
                { "company": "Armis", "format": "{first}.{last}@armis.com", "alt": "" },
                { "company": "Cyera", "format": "{first}.{last}@cyera.io", "alt": "" },
                { "company": "Delinea", "format": "{first}.{last}@delinea.com", "alt": "" },
                { "company": "Island", "format": "{first}.{last}@island.io", "alt": "" },
                { "company": "NinjaOne", "format": "{first}.{last}@ninjaone.com", "alt": "{first}.{last}@ninjarmm.com" },
                { "company": "Ping Identity", "format": "{first}.{last}@pingidentity.com", "alt": "" },
                { "company": "Ping", "format": "{first}.{last}@pingidentity.com", "alt": "" },
                { "company": "Proofpoint", "format": "{first}.{last}@proofpoint.com", "alt": "" },
                { "company": "Verkada", "format": "{first}.{last}@verkada.com", "alt": "" },
                { "company": "Cato Networks", "format": "{first}.{last}@catonetworks.com", "alt": "" },
                { "company": "Cato", "format": "{first}.{last}@catonetworks.com", "alt": "" },
                { "company": "Illumio", "format": "{first}.{last}@illumio.com", "alt": "" },
                { "company": "ReliaQuest", "format": "{first}.{last}@reliaquest.com", "alt": "" },
                { "company": "Axonius", "format": "{first}.{last}@axonius.com", "alt": "" },
                { "company": "Kaseya", "format": "{first}.{last}@kaseya.com", "alt": "" },
                { "company": "SailPoint", "format": "{first}.{last}@sailpoint.com", "alt": "" },
                { "company": "Fortinet", "format": "{first}.{last}@fortinet.com", "alt": "" },
                { "company": "Axiad", "format": "{first}.{last}@axiad.com", "alt": "" },

                // SaaS & Enterprise
                { "company": "Salesforce", "format": "{f}{last}@salesforce.com", "alt": "{first}.{last}@salesforce.com" },
                { "company": "ServiceNow", "format": "{first}.{last}@servicenow.com", "alt": "" },
                { "company": "Workday", "format": "{first}.{last}@workday.com", "alt": "" },
                { "company": "Adobe", "format": "{f}{last}@adobe.com", "alt": "" },
                { "company": "HubSpot", "format": "{first}.{last}@hubspot.com", "alt": "" },
                { "company": "Notion", "format": "{first}.{last}@makenotion.com", "alt": "{first}@makenotion.com" },
                { "company": "Airtable", "format": "{first}.{last}@airtable.com", "alt": "" },
                { "company": "Figma", "format": "{first}.{last}@figma.com", "alt": "{first}@figma.com" },
                { "company": "Miro", "format": "{first}.{last}@miro.com", "alt": "" },
                { "company": "Loom", "format": "{first}.{last}@loom.com", "alt": "" },
                { "company": "Scribe", "format": "{first}@scribehow.com", "alt": "" },
                { "company": "Air", "format": "{first}@air.inc", "alt": "" },
                { "company": "ServiceTitan", "format": "{f}{last}@servicetitan.com", "alt": "" },
                { "company": "Samsara", "format": "{first}.{last}@samsara.com", "alt": "" },
                { "company": "Toast", "format": "{first}.{last}@toasttab.com", "alt": "" },
                { "company": "Shopify", "format": "{first}.{last}@shopify.com", "alt": "" },
                { "company": "Atlassian", "format": "{first}.{last}@atlassian.com", "alt": "" },
                { "company": "Zoom", "format": "{first}.{last}@zoom.us", "alt": "" },
                { "company": "Box", "format": "{first}.{last}@box.com", "alt": "" },
                { "company": "Dropbox", "format": "{first}.{last}@dropbox.com", "alt": "" },
                { "company": "DocuSign", "format": "{first}.{last}@docusign.com", "alt": "" },
                { "company": "Procore", "format": "{first}.{last}@procore.com", "alt": "" },
                { "company": "CrewAI", "format": "{first}@crewai.com", "alt": "" },
                { "company": "Crew AI", "format": "{first}@crewai.com", "alt": "" },
                { "company": "EvenUp", "format": "{first}.{last}@evenuplaw.com", "alt": "" },
                { "company": "BambooHR", "format": "{f}{last}@bamboohr.com", "alt": "" },
                { "company": "Blue Yonder", "format": "{first}.{last}@blueyonder.com", "alt": "" },
                { "company": "Clio", "format": "{first}.{last}@clio.com", "alt": "" },
                { "company": "Cohesity", "format": "{first}.{last}@cohesity.com", "alt": "" },
                { "company": "Dialpad", "format": "{first}.{last}@dialpad.com", "alt": "" },
                { "company": "Doctolib", "format": "{first}.{last}@doctolib.com", "alt": "" },
                { "company": "Elementum", "format": "{f}{last}@elementum.com", "alt": "" },
                { "company": "Gong", "format": "{first}.{last}@gong.io", "alt": "" },
                { "company": "Kraken", "format": "{first}.{last}@octopus.energy", "alt": "{first}.{last}@krakenflex.com" },
                { "company": "Locus", "format": "{first}.{last}@locus.sh", "alt": "" },
                { "company": "Mindbody", "format": "{first}.{last}@mindbodyonline.com", "alt": "" },
                { "company": "PsiQuantum", "format": "{first}.{last}@psiquantum.com", "alt": "" },
                { "company": "Rippling", "format": "{first}.{last}@rippling.com", "alt": "" },
                { "company": "StackAdapt", "format": "{first}.{last}@stackadapt.com", "alt": "" },
                { "company": "Superhuman", "format": "{first}@superhuman.com", "alt": "" },
                { "company": "Tekion", "format": "{first}.{last}@tekion.com", "alt": "" },
                { "company": "Uniphore", "format": "{first}.{last}@uniphore.com", "alt": "" },
                { "company": "Celonis", "format": "{first}.{last}@celonis.com", "alt": "" },
                { "company": "Diligent", "format": "{first}.{last}@diligent.com", "alt": "" },
                { "company": "HighLevel", "format": "{first}@gohighlevel.com", "alt": "" },
                { "company": "HighSpot", "format": "{first}.{last}@highspot.com", "alt": "" },
                { "company": "Ideagen", "format": "{first}.{last}@ideagen.com", "alt": "" },
                { "company": "Mark43", "format": "{first}.{last}@mark43.com", "alt": "" },
                { "company": "Pendo", "format": "{first}.{last}@pendo.io", "alt": "" },
                { "company": "Podium", "format": "{first}.{last}@podium.com", "alt": "" },
                { "company": "Restaurant365", "format": "{f}{last}@restaurant365.net", "alt": "{f}{last}@restaurant365.com" },
                { "company": "Traversal", "format": "{first}@traversal.com", "alt": "" },
                { "company": "YipitData", "format": "{first}.{last}@yipitdata.com", "alt": "" },
                { "company": "Zendesk", "format": "{first}{last}@zendesk.com", "alt": "" },
                { "company": "Attain", "format": "{f}{last}@attaindata.io", "alt": "" },
                { "company": "Front", "format": "{first}.{last}@frontapp.com", "alt": "" },
                { "company": "GupShup", "format": "{first}@gupshup.io", "alt": "" },
                { "company": "Gusto", "format": "{first}.{last}@gusto.com", "alt": "" },
                { "company": "Icertis", "format": "{first}.{last}@icertis.com", "alt": "" },
                { "company": "Seismic", "format": "{f}{last}@seismic.com", "alt": "" },
                { "company": "ADP", "format": "{first}.{last}@adp.com", "alt": "" },
                { "company": "Agorapulse", "format": "{first}@agorapulse.com", "alt": "" },
                { "company": "Anthology", "format": "{first}.{last}@anthology.com", "alt": "" },
                { "company": "Asana", "format": "{first}.{last}@asana.com", "alt": "" },
                { "company": "Blackbaud", "format": "{first}.{last}@blackbaud.com", "alt": "" },
                { "company": "Guidewire", "format": "{first}.{last}@guidewire.com", "alt": "" },
                { "company": "Indeed", "format": "{first}.{last}@indeed.com", "alt": "" },
                { "company": "Klaviyo", "format": "{first}.{last}@klaviyo.com", "alt": "" },
                { "company": "Paylocity", "format": "{first}.{last}@paylocity.com", "alt": "" },
                { "company": "Paycom", "format": "{first}.{last}@paycom.com", "alt": "" },
                { "company": "The Trade Desk", "format": "{first}.{last}@thetradedesk.com", "alt": "" },
                { "company": "UiPath", "format": "{first}.{last}@uipath.com", "alt": "" },
                { "company": "Veeva", "format": "{first}.{last}@veeva.com", "alt": "" },
                { "company": "BlackLine", "format": "{first}.{last}@blackline.com", "alt": "" },
                { "company": "Cornerstone", "format": "{first}.{last}@csod.com", "alt": "" },
                { "company": "Domo", "format": "{first}.{last}@domo.com", "alt": "" },
                { "company": "Tableau", "format": "{first}.{last}@tableau.com", "alt": "" },
                { "company": "Qlik", "format": "{first}.{last}@qlik.com", "alt": "" },
                { "company": "Alteryx", "format": "{first}.{last}@alteryx.com", "alt": "" },
                { "company": "Kiteworks", "format": "{first}.{last}@kiteworks.com", "alt": "" },
                { "company": "PerformYard", "format": "{first}.{last}@performyard.com", "alt": "" },
                { "company": "Hive", "format": "{first}@hive.com", "alt": "" },
                { "company": "Nasuni", "format": "{first}.{last}@nasuni.com", "alt": "" },
                { "company": "Instantly", "format": "{first}@instantly.ai", "alt": "" },
                { "company": "Supademo", "format": "{first}@supademo.com", "alt": "" },
                { "company": "AppLovin", "format": "{first}.{last}@applovin.com", "alt": "" },
                { "company": "Arcana Network", "format": "{first}@arcana.io", "alt": "" },
                { "company": "Arcana", "format": "{first}@arcana.io", "alt": "" },

                // Fintech
                { "company": "Stripe", "format": "{f}{last}@stripe.com", "alt": "{first}@stripe.com" },
                { "company": "Plaid", "format": "{first}.{last}@plaid.com", "alt": "" },
                { "company": "Ramp", "format": "{first}.{last}@ramp.com", "alt": "{first}@ramp.com" },
                { "company": "Brex", "format": "{first}.{last}@brex.com", "alt": "" },
                { "company": "Deel", "format": "{first}.{last}@deel.com", "alt": "" },
                { "company": "Navan", "format": "{first}.{last}@navan.com", "alt": "" },
                { "company": "TripActions", "format": "{first}.{last}@navan.com", "alt": "" },
                { "company": "Bolt", "format": "{first}.{last}@bolt.com", "alt": "" },
                { "company": "Carta", "format": "{first}.{last}@carta.com", "alt": "" },
                { "company": "Tipalti", "format": "{first}.{last}@tipalti.com", "alt": "" },
                { "company": "FloQast", "format": "{first}.{last}@floqast.com", "alt": "" },
                { "company": "Intuit", "format": "{first}_{last}@intuit.com", "alt": "" },

                // Legacy / Big Tech
                { "company": "Amazon", "format": "{last}{f}@amazon.com", "alt": "{f}{last}@amazon.com" },
                { "company": "Microsoft", "format": "{first}.{last}@microsoft.com", "alt": "" },
                { "company": "Google", "format": "{first}{last}@google.com", "alt": "{first}.{last}@google.com" },
                { "company": "Apple", "format": "{f}{last}@apple.com", "alt": "{first}_{last}@apple.com" },
                { "company": "Meta", "format": "{first}{last}@meta.com", "alt": "{f}{last}@fb.com" },
                { "company": "Facebook", "format": "{first}{last}@meta.com", "alt": "{f}{last}@fb.com" },
                { "company": "Oracle", "format": "{first}.{last}@oracle.com", "alt": "" },
                { "company": "Cisco", "format": "{f}{last}@cisco.com", "alt": "" },
                { "company": "Intel", "format": "{first}.{last}@intel.com", "alt": "" },
                { "company": "IBM", "format": "{first}.{last}@ibm.com", "alt": "{first}.{last}@us.ibm.com" },
                { "company": "Nvidia", "format": "{f}{last}@nvidia.com", "alt": "" },
                { "company": "Tesla", "format": "{f}{last}@tesla.com", "alt": "{first}@tesla.com" },
                { "company": "Netflix", "format": "{f}{last}@netflix.com", "alt": "" },
                { "company": "Topicus", "format": "{first}.{last}@topicus.nl", "alt": "" },
                { "company": "EPAM Systems", "format": "{first}_{last}@epam.com", "alt": "" },
                { "company": "EPAM", "format": "{first}_{last}@epam.com", "alt": "" },
                { "company": "Nemetschek", "format": "{f}{last}@nemetschek.com", "alt": "" },
                { "company": "WiseTech Global", "format": "{f}{last}@wisetechglobal.com", "alt": "" },
                { "company": "WiseTech", "format": "{f}{last}@wisetechglobal.com", "alt": "" },
                { "company": "Alibaba Cloud", "format": "{first}.{last}@alibabacloud.com", "alt": "" },
                { "company": "Alibaba", "format": "{first}.{last}@alibabacloud.com", "alt": "" },
                { "company": "Amdocs", "format": "{first}.{last}@amdocs.com", "alt": "" },
                { "company": "Baidu", "format": "{first}{last}@baidu.com", "alt": "" },
                { "company": "Bentley Systems", "format": "{first}.{last}@bentley.com", "alt": "" },
                { "company": "Bentley", "format": "{first}.{last}@bentley.com", "alt": "" },
                { "company": "Mobileye", "format": "{first}.{last}@mobileye.com", "alt": "" },
                { "company": "OpenText", "format": "{f}{last}@opentext.com", "alt": "" },
                { "company": "Tencent", "format": "{first}{last}@tencent.com", "alt": "" },
                { "company": "Xero", "format": "{first}.{last}@xero.com", "alt": "" },
                { "company": "Akamai", "format": "{first}.{last}@akamai.com", "alt": "" },
                { "company": "Gen Digital", "format": "{first}.{last}@gendigital.com", "alt": "" },
                { "company": "Synopsys", "format": "{first}.{last}@synopsys.com", "alt": "" },
                { "company": "Cadence", "format": "{first}.{last}@cadence.com", "alt": "" },
                { "company": "SS&C", "format": "{first}.{last}@sscinc.com", "alt": "" },

                // Finance (from original)
                { "company": "Goldman Sachs", "format": "{first}.{last}@gs.com", "alt": "" },
                { "company": "Morgan Stanley", "format": "{first}.{last}@morganstanley.com", "alt": "" },
                { "company": "J.P. Morgan", "format": "{first}.{last}@jpmorgan.com", "alt": "" },
                { "company": "JPMorgan", "format": "{first}.{last}@jpmorgan.com", "alt": "" },
                { "company": "Bank of America", "format": "{first}.{last}@bofa.com", "alt": "" },
                { "company": "BofA", "format": "{first}.{last}@bofa.com", "alt": "" },
                { "company": "Citi", "format": "{first}.{last}@citi.com", "alt": "" },
                { "company": "Citigroup", "format": "{first}.{last}@citi.com", "alt": "" },
                { "company": "Barclays", "format": "{first}.{last}@barclays.com", "alt": "" },
                { "company": "UBS", "format": "{first}.{last}@ubs.com", "alt": "" },
                { "company": "Deutsche Bank", "format": "{first}.{last}@db.com", "alt": "" },
                { "company": "Evercore", "format": "{first}.{last}@evercore.com", "alt": "" },
                { "company": "Centerview", "format": "{f}{last}@centerview.com", "alt": "" },
                { "company": "Centerview Partners", "format": "{f}{last}@centerview.com", "alt": "" },
                { "company": "Lazard", "format": "{first}.{last}@lazard.com", "alt": "" },
                { "company": "PJT Partners", "format": "{first}.{last}@pjtpartners.com", "alt": "" },
                { "company": "Moelis & Co", "format": "{first}.{last}@moelis.com", "alt": "" },
                { "company": "Moelis", "format": "{first}.{last}@moelis.com", "alt": "" },
                { "company": "Qatalyst Partners", "format": "{first}.{last}@qatalyst.com", "alt": "" },
                { "company": "Qatalyst", "format": "{first}.{last}@qatalyst.com", "alt": "" },
                { "company": "Guggenheim", "format": "{first}.{last}@guggenheimpartners.com", "alt": "" },
                { "company": "Perella Weinberg", "format": "{f}{last}@pwpartners.com", "alt": "" },
                { "company": "Jefferies", "format": "{f}{last}@jefferies.com", "alt": "" },
                { "company": "Houlihan Lokey", "format": "{f}{last}@hl.com", "alt": "" },
                { "company": "William Blair", "format": "{f}{last}@williamblair.com", "alt": "" },
                { "company": "RBC Capital Markets", "format": "{first}.{last}@rbccm.com", "alt": "" },
                { "company": "RBC", "format": "{first}.{last}@rbccm.com", "alt": "" },
                { "company": "BMO Capital Markets", "format": "{first}.{last}@bmo.com", "alt": "" },
                { "company": "BMO", "format": "{first}.{last}@bmo.com", "alt": "" },
                { "company": "Piper Sandler", "format": "{first}.{last}@psc.com", "alt": "" },
                { "company": "Raymond James", "format": "{first}.{last}@raymondjames.com", "alt": "" },
                { "company": "Rothschild & Co", "format": "{first}.{last}@rothschildandco.com", "alt": "" },
                { "company": "Rothschild", "format": "{first}.{last}@rothschildandco.com", "alt": "" },
                { "company": "Stifel", "format": "{last}{f}@stifel.com", "alt": "" },
                { "company": "Wells Fargo", "format": "{first}.{last}@wellsfargo.com", "alt": "" },

                // === INVESTMENT FIRMS (PE, HEDGE FUNDS, PROP TRADING) ===
                // PE Giants
                { "company": "Apollo Global", "format": "{first_initial}{last}@apollo.com", "alt": "" },
                { "company": "Apollo", "format": "{first_initial}{last}@apollo.com", "alt": "" },
                { "company": "Carlyle Group", "format": "{first}.{last}@carlyle.com", "alt": "" },
                { "company": "Carlyle", "format": "{first}.{last}@carlyle.com", "alt": "" },
                { "company": "KKR", "format": "{first}.{last}@kkr.com", "alt": "" },
                { "company": "Warburg Pincus", "format": "{first}.{last}@warburgpincus.com", "alt": "" },
                { "company": "Bain Capital", "format": "{f}{last}@baincapital.com", "alt": "" },
                { "company": "Advent International", "format": "{first_initial}{last}@adventinternational.com", "alt": "" },
                { "company": "Advent", "format": "{first_initial}{last}@adventinternational.com", "alt": "" },
                { "company": "Hellman & Friedman", "format": "{first_initial}{last}@hf.com", "alt": "" },
                { "company": "H&F", "format": "{first_initial}{last}@hf.com", "alt": "" },
                { "company": "TPG", "format": "{first}.{last}@tpg.com", "alt": "" },
                { "company": "General Atlantic", "format": "{first_initial}{last}@generalatlantic.com", "alt": "" },
                { "company": "Leonard Green", "format": "{first_initial}{last}@leonardgreen.com", "alt": "" },
                { "company": "Clearlake", "format": "{first_initial}{last}@clearlake.com", "alt": "" },
                { "company": "Insight Partners", "format": "{first_initial}{last}@insightpartners.com", "alt": "" },
                { "company": "Summit Partners", "format": "{first_initial}{last}@summitpartners.com", "alt": "" },
                { "company": "TA Associates", "format": "{first_initial}{last}@ta.com", "alt": "" },
                { "company": "Permira", "format": "{first}.{last}@permira.com", "alt": "" },
                { "company": "CVC Capital", "format": "{first_initial}{last}@cvc.com", "alt": "" },
                { "company": "CVC", "format": "{first_initial}{last}@cvc.com", "alt": "" },
                { "company": "EQT", "format": "{first}.{last}@eqtpartners.com", "alt": "" },
                { "company": "Providence Equity", "format": "{first_initial}{last}@provequity.com", "alt": "" },
                { "company": "Providence", "format": "{first_initial}{last}@provequity.com", "alt": "" },
                { "company": "GTCR", "format": "{first_initial}{last}@gtcr.com", "alt": "" },
                { "company": "Genstar", "format": "{first_initial}{last}@gencap.com", "alt": "" },
                { "company": "Veritas Capital", "format": "{first_initial}{last}@veritascapital.com", "alt": "" },
                { "company": "Francisco Partners", "format": "{first_initial}{last}@fpcp.com", "alt": "" },
                { "company": "HGGC", "format": "{first_initial}{last}@hggc.com", "alt": "" },
                { "company": "Golden Gate Capital", "format": "{first_initial}{last}@goldengatecap.com", "alt": "" },
                { "company": "Golden Gate", "format": "{first_initial}{last}@goldengatecap.com", "alt": "" },
                { "company": "American Securities", "format": "{first_initial}{last}@american-securities.com", "alt": "" },
                { "company": "Welsh Carson", "format": "{first_initial}{last}@wcas.com", "alt": "" },
                { "company": "WCAS", "format": "{first_initial}{last}@wcas.com", "alt": "" },
                { "company": "New Mountain Capital", "format": "{first_initial}{last}@newmountaincapital.com", "alt": "" },
                { "company": "New Mountain", "format": "{first_initial}{last}@newmountaincapital.com", "alt": "" },
                { "company": "Clayton Dubilier", "format": "{first_initial}{last}@cdr-inc.com", "alt": "" },
                { "company": "CD&R", "format": "{first_initial}{last}@cdr-inc.com", "alt": "" },
                { "company": "Audax Group", "format": "{first_initial}{last}@audaxgroup.com", "alt": "" },
                { "company": "Audax", "format": "{first_initial}{last}@audaxgroup.com", "alt": "" },
                { "company": "Roark Capital", "format": "{first_initial}{last}@roarkcapital.com", "alt": "" },
                { "company": "Roark", "format": "{first_initial}{last}@roarkcapital.com", "alt": "" },
                { "company": "Sycamore Partners", "format": "{first_initial}{last}@sycamorepartners.com", "alt": "" },
                { "company": "Sycamore", "format": "{first_initial}{last}@sycamorepartners.com", "alt": "" },
                { "company": "Onex", "format": "{first_initial}{last}@onex.com", "alt": "" },
                { "company": "Altas Partners", "format": "{first_initial}{last}@altas.com", "alt": "" },
                { "company": "Altas", "format": "{first_initial}{last}@altas.com", "alt": "" },
                { "company": "Stone Point", "format": "{first_initial}{last}@stonepoint.com", "alt": "" },
                { "company": "Kelso", "format": "{first_initial}{last}@kelso.com", "alt": "" },
                { "company": "Vestar Capital", "format": "{first_initial}{last}@vestarcapital.com", "alt": "" },
                { "company": "Vestar", "format": "{first_initial}{last}@vestarcapital.com", "alt": "" },
                { "company": "Thomas H. Lee", "format": "{first_initial}{last}@thl.com", "alt": "" },
                { "company": "THL", "format": "{first_initial}{last}@thl.com", "alt": "" },
                { "company": "Berkshire Partners", "format": "{first_initial}{last}@berkshirepartners.com", "alt": "" },
                { "company": "Centerbridge", "format": "{first_initial}{last}@centerbridge.com", "alt": "" },
                { "company": "Cerberus", "format": "{first_initial}{last}@cerberus.com", "alt": "" },
                { "company": "Fortress", "format": "{first_initial}{last}@fortress.com", "alt": "" },
                { "company": "Ares Management", "format": "{first_initial}{last}@aresmgmt.com", "alt": "" },
                { "company": "Ares", "format": "{first_initial}{last}@aresmgmt.com", "alt": "" },
                { "company": "Oaktree", "format": "{first_initial}{last}@oaktreecapital.com", "alt": "" },
                { "company": "Sixth Street", "format": "{first_initial}{last}@sixthstreet.com", "alt": "" },

                // Hedge Funds
                { "company": "Citadel", "format": "{first}.{last}@citadel.com", "alt": "" },
                { "company": "Millennium", "format": "{first}.{last}@mlp.com", "alt": "" },
                { "company": "Point72", "format": "{first}.{last}@point72.com", "alt": "" },
                { "company": "Bridgewater", "format": "{first}.{last}@bwater.com", "alt": "" },
                { "company": "D. E. Shaw", "format": "{first}.{last}@deshaw.com", "alt": "" },
                { "company": "DE Shaw", "format": "{first}.{last}@deshaw.com", "alt": "" },
                { "company": "Two Sigma", "format": "{first}.{last}@twosigma.com", "alt": "" },
                { "company": "Elliott Management", "format": "{first_initial}{last}@elliottmgmt.com", "alt": "" },
                { "company": "Elliott", "format": "{first_initial}{last}@elliottmgmt.com", "alt": "" },
                { "company": "Viking Global", "format": "{first_initial}{last}@vikingglobal.com", "alt": "" },
                { "company": "Viking", "format": "{first_initial}{last}@vikingglobal.com", "alt": "" },
                { "company": "Lone Pine", "format": "{first_initial}{last}@lonepine.com", "alt": "" },
                { "company": "Coatue", "format": "{first_initial}{last}@coatue.com", "alt": "" },
                { "company": "Tiger Global", "format": "{first}.{last}@tigerglobal.com", "alt": "" },
                { "company": "Tiger", "format": "{first}.{last}@tigerglobal.com", "alt": "" },
                { "company": "Third Point", "format": "{first_initial}{last}@thirdpoint.com", "alt": "" },
                { "company": "Pershing Square", "format": "{first_initial}{last}@pershingsq.com", "alt": "" },
                { "company": "Greenlight Capital", "format": "{first_initial}{last}@greenlightcapital.com", "alt": "" },
                { "company": "Greenlight", "format": "{first_initial}{last}@greenlightcapital.com", "alt": "" },
                { "company": "Baupost Group", "format": "{first_initial}{last}@baupost.com", "alt": "" },
                { "company": "Baupost", "format": "{first_initial}{last}@baupost.com", "alt": "" },
                { "company": "Farallon", "format": "{first_initial}{last}@farallon.com", "alt": "" },
                { "company": "Davidson Kempner", "format": "{first_initial}{last}@dkpartners.com", "alt": "" },
                { "company": "King Street", "format": "{first_initial}{last}@kingstreet.com", "alt": "" },
                { "company": "Canyon Partners", "format": "{first_initial}{last}@canyonpartners.com", "alt": "" },
                { "company": "Canyon", "format": "{first_initial}{last}@canyonpartners.com", "alt": "" },
                { "company": "GoldenTree", "format": "{first_initial}{last}@goldentree.com", "alt": "" },
                { "company": "Anchorage Capital", "format": "{first_initial}{last}@anchoragecap.com", "alt": "" },
                { "company": "Sculptor", "format": "{first_initial}{last}@sculptor.com", "alt": "" },
                { "company": "Och-Ziff", "format": "{first_initial}{last}@sculptor.com", "alt": "" },
                { "company": "Man Group", "format": "{first}.{last}@man.com", "alt": "" },
                { "company": "AQR", "format": "{first_initial}{last}@aqr.com", "alt": "" },
                { "company": "Winton", "format": "{first_initial}{last}@winton.com", "alt": "" },
                { "company": "Capula", "format": "{first_initial}{last}@capulaglobal.com", "alt": "" },
                { "company": "Brevan Howard", "format": "{first_initial}{last}@brevanhoward.com", "alt": "" },
                { "company": "Rokos Capital", "format": "{first_initial}{last}@rokoscapital.com", "alt": "" },
                { "company": "Rokos", "format": "{first_initial}{last}@rokoscapital.com", "alt": "" },
                { "company": "Caxton", "format": "{first_initial}{last}@caxton.com", "alt": "" },
                { "company": "Moore Capital", "format": "{first_initial}{last}@moorecap.com", "alt": "" },
                { "company": "Moore", "format": "{first_initial}{last}@moorecap.com", "alt": "" },
                { "company": "Tudor Investment", "format": "{first_initial}{last}@tudor.com", "alt": "" },
                { "company": "Tudor", "format": "{first_initial}{last}@tudor.com", "alt": "" },
                { "company": "Soros Fund", "format": "{first_initial}{last}@soros.com", "alt": "" },
                { "company": "Soros", "format": "{first_initial}{last}@soros.com", "alt": "" },
                { "company": "Duquesne", "format": "{first_initial}{last}@duquesne.com", "alt": "" },
                { "company": "Appaloosa", "format": "{first_initial}{last}@appaloosa.com", "alt": "" },
                { "company": "Omega Advisors", "format": "{first_initial}{last}@omegaadvisors.com", "alt": "" },
                { "company": "Omega", "format": "{first_initial}{last}@omegaadvisors.com", "alt": "" },
                { "company": "Maverick Capital", "format": "{first_initial}{last}@maverickcap.com", "alt": "" },
                { "company": "Maverick", "format": "{first_initial}{last}@maverickcap.com", "alt": "" },
                { "company": "Glenview", "format": "{first_initial}{last}@glenviewcapital.com", "alt": "" },
                { "company": "Eminence", "format": "{first_initial}{last}@eminencecapital.com", "alt": "" },
                { "company": "ValueAct", "format": "{first_initial}{last}@valueact.com", "alt": "" },
                { "company": "TCI Fund", "format": "{first}.{last}@tcifund.com", "alt": "" },
                { "company": "TCI", "format": "{first}.{last}@tcifund.com", "alt": "" },
                { "company": "Egerton", "format": "{first_initial}{last}@egertoncapital.com", "alt": "" },
                { "company": "Marshall Wace", "format": "{first}.{last}@mwam.com", "alt": "" },
                { "company": "Magnetar", "format": "{first_initial}{last}@magnetar.com", "alt": "" },
                { "company": "Hudson Bay", "format": "{first_initial}{last}@hudsonbaycapital.com", "alt": "" },
                { "company": "Balyasny", "format": "{first}.{last}@bamfunds.com", "alt": "" },
                { "company": "BAM", "format": "{first}.{last}@bamfunds.com", "alt": "" },
                { "company": "ExodusPoint", "format": "{first}.{last}@exoduspoint.com", "alt": "" },
                { "company": "Verition", "format": "{first}.{last}@veritionfund.com", "alt": "" },
                { "company": "Schonfeld", "format": "{first}.{last}@schonfeld.com", "alt": "" },
                { "company": "BlueCrest", "format": "{first}.{last}@bluecrestcapital.com", "alt": "" },

                // Prop Trading
                { "company": "Jane Street", "format": "{first}@janestreet.com", "alt": "" },
                { "company": "Hudson River Trading", "format": "{first}@hudson-trading.com", "alt": "" },
                { "company": "HRT", "format": "{first}@hudson-trading.com", "alt": "" },
                { "company": "Jump Trading", "format": "{first_initial}{last}@jumptrading.com", "alt": "" },
                { "company": "Jump", "format": "{first_initial}{last}@jumptrading.com", "alt": "" },
                { "company": "DRW", "format": "{first_initial}{last}@drw.com", "alt": "" },
                { "company": "Susquehanna", "format": "{first}.{last}@sig.com", "alt": "" },
                { "company": "SIG", "format": "{first}.{last}@sig.com", "alt": "" },
                { "company": "Virtu Financial", "format": "{first_initial}{last}@virtu.com", "alt": "" },
                { "company": "Virtu", "format": "{first_initial}{last}@virtu.com", "alt": "" },
                { "company": "Flow Traders", "format": "{first}.{last}@flowtraders.com", "alt": "" },
                { "company": "Optiver", "format": "{first}.{last}@optiver.com", "alt": "" },
                { "company": "IMC", "format": "{first}.{last}@imc.com", "alt": "" },

                // === VENTURE CAPITAL ===
                { "company": "Benchmark", "format": "{first}@benchmark.com", "alt": "" },
                { "company": "Greylock", "format": "{first}@greylock.com", "alt": "" },
                { "company": "Index Ventures", "format": "{first}@indexventures.com", "alt": "" },
                { "company": "Index", "format": "{first}@indexventures.com", "alt": "" },
                { "company": "Accel", "format": "{first}@accel.com", "alt": "" },
                { "company": "Kleiner Perkins", "format": "{first}@kp.com", "alt": "" },
                { "company": "KPCB", "format": "{first}@kp.com", "alt": "" },
                { "company": "Founders Fund", "format": "{first}@foundersfund.com", "alt": "" },
                { "company": "Khosla Ventures", "format": "{first}@khosla.com", "alt": "" },
                { "company": "Khosla", "format": "{first}@khosla.com", "alt": "" },
                { "company": "General Catalyst", "format": "{first_initial}{last}@generalcatalyst.com", "alt": "" },
                { "company": "Bessemer", "format": "{first_initial}{last}@bvp.com", "alt": "" },
                { "company": "BVP", "format": "{first_initial}{last}@bvp.com", "alt": "" },
                { "company": "Lightspeed", "format": "{first}@lsvp.com", "alt": "" },
                { "company": "NEA", "format": "{first_initial}{last}@nea.com", "alt": "" },
                { "company": "Redpoint", "format": "{first}@redpoint.com", "alt": "" },
                { "company": "IVP", "format": "{first_initial}{last}@ivp.com", "alt": "" },
                { "company": "GGV Capital", "format": "{first}.{last}@ggvc.com", "alt": "" },
                { "company": "GGV", "format": "{first}.{last}@ggvc.com", "alt": "" },
                { "company": "Battery Ventures", "format": "{first_initial}{last}@battery.com", "alt": "" },
                { "company": "Battery", "format": "{first_initial}{last}@battery.com", "alt": "" },
                { "company": "Canaan Partners", "format": "{first_initial}{last}@canaan.com", "alt": "" },
                { "company": "Canaan", "format": "{first_initial}{last}@canaan.com", "alt": "" },
                { "company": "Menlo Ventures", "format": "{first}@menlovc.com", "alt": "" },
                { "company": "Menlo", "format": "{first}@menlovc.com", "alt": "" },
                { "company": "Union Square Ventures", "format": "{first}@usv.com", "alt": "" },
                { "company": "USV", "format": "{first}@usv.com", "alt": "" },
                { "company": "CRV", "format": "{first}@crv.com", "alt": "" },
                { "company": "DCM", "format": "{first_initial}{last}@dcm.com", "alt": "" },
                { "company": "Mayfield", "format": "{first_initial}{last}@mayfield.com", "alt": "" },
                { "company": "True Ventures", "format": "{first}@trueventures.com", "alt": "" },
                { "company": "True", "format": "{first}@trueventures.com", "alt": "" },
                { "company": "First Round", "format": "{first}@firstround.com", "alt": "" },
                { "company": "Greycroft", "format": "{first_initial}{last}@greycroft.com", "alt": "" },
                { "company": "Spark Capital", "format": "{first}@sparkcapital.com", "alt": "" },
                { "company": "Spark", "format": "{first}@sparkcapital.com", "alt": "" },
                { "company": "Felicis", "format": "{first}@felicis.com", "alt": "" },
                { "company": "Floodgate", "format": "{first}@floodgate.com", "alt": "" },
                { "company": "Forerunner", "format": "{first}@forerunner.vc", "alt": "" },
                { "company": "Obvious Ventures", "format": "{first}@obvious.com", "alt": "" },
                { "company": "Obvious", "format": "{first}@obvious.com", "alt": "" },
                { "company": "Social Capital", "format": "{first}@socialcapital.com", "alt": "" },
                { "company": "Initialized", "format": "{first}@initialized.com", "alt": "" },
                { "company": "8VC", "format": "{first}@8vc.com", "alt": "" },
                { "company": "DCVC", "format": "{first}.{last}@dcvc.com", "alt": "" },
                { "company": "Lux Capital", "format": "{first}@luxcapital.com", "alt": "" },
                { "company": "Lux", "format": "{first}@luxcapital.com", "alt": "" },
                { "company": "RRE Ventures", "format": "{first_initial}{last}@rre.com", "alt": "" },
                { "company": "RRE", "format": "{first_initial}{last}@rre.com", "alt": "" },
                { "company": "TCV", "format": "{first_initial}{last}@tcv.com", "alt": "" },
                { "company": "Dragoneer", "format": "{first}.{last}@dragoneer.com", "alt": "" },
                { "company": "Greenoaks", "format": "{first}@greenoaks.com", "alt": "" },
                { "company": "Bond Capital", "format": "{first}@bondcap.com", "alt": "" },
                { "company": "Bond", "format": "{first}@bondcap.com", "alt": "" },
                { "company": "Ribbit Capital", "format": "{first}@ribbitcap.com", "alt": "" },
                { "company": "Ribbit", "format": "{first}@ribbitcap.com", "alt": "" },
                { "company": "Y Combinator", "format": "{first}@ycombinator.com", "alt": "" },
                { "company": "YC", "format": "{first}@ycombinator.com", "alt": "" },
                { "company": "500 Global", "format": "{first}@500.co", "alt": "" },
                { "company": "500 Startups", "format": "{first}@500.co", "alt": "" },
                { "company": "Techstars", "format": "{first}.{last}@techstars.com", "alt": "" },
                { "company": "Pear VC", "format": "{first}@pear.vc", "alt": "" },
                { "company": "Pear", "format": "{first}@pear.vc", "alt": "" },
                { "company": "Uncork Capital", "format": "{first}@uncorkcapital.com", "alt": "" },
                { "company": "Uncork", "format": "{first}@uncorkcapital.com", "alt": "" },
                { "company": "Baseline", "format": "{first}@baselinev.com", "alt": "" },
                { "company": "Cowboy Ventures", "format": "{first}@cowboy.vc", "alt": "" },
                { "company": "Cowboy", "format": "{first}@cowboy.vc", "alt": "" },
                { "company": "Homebrew", "format": "{first}@homebrew.co", "alt": "" },
                { "company": "Freestyle", "format": "{first}@freestyle.vc", "alt": "" },
                { "company": "Harrison Metal", "format": "{first}@harrisonmetal.com", "alt": "" },
                { "company": "K9 Ventures", "format": "{first}@k9ventures.com", "alt": "" },
                { "company": "K9", "format": "{first}@k9ventures.com", "alt": "" },
                { "company": "Afore Capital", "format": "{first}@afore.vc", "alt": "" },
                { "company": "Afore", "format": "{first}@afore.vc", "alt": "" },
                { "company": "Precursor", "format": "{first}@precursorvc.com", "alt": "" },
                { "company": "Susa Ventures", "format": "{first}@susaventures.com", "alt": "" },
                { "company": "Susa", "format": "{first}@susaventures.com", "alt": "" },
                { "company": "BoxGroup", "format": "{first}@boxgroup.com", "alt": "" },
                { "company": "Lerer Hippeau", "format": "{first}@lererhippeau.com", "alt": "" },
                { "company": "Version One", "format": "{first}@versionone.vc", "alt": "" },
                { "company": "M13", "format": "{first}@m13.co", "alt": "" },
                { "company": "SignalFire", "format": "{first}@signalfire.com", "alt": "" },
                { "company": "NFX", "format": "{first}@nfx.com", "alt": "" },
                { "company": "Defy", "format": "{first}@defy.vc", "alt": "" },
                { "company": "Aspect Ventures", "format": "{first}@aspectventures.com", "alt": "" },
                { "company": "Aspect", "format": "{first}@aspectventures.com", "alt": "" },
                { "company": "Foundation Capital", "format": "{first_initial}{last}@foundationcap.com", "alt": "" },
                { "company": "Foundation", "format": "{first_initial}{last}@foundationcap.com", "alt": "" },
                { "company": "Costanoa", "format": "{first}@costanoavc.com", "alt": "" },
                { "company": "Crosslink", "format": "{first_initial}{last}@crosslinkcapital.com", "alt": "" },
                { "company": "Tenaya", "format": "{first_initial}{last}@tenayacapital.com", "alt": "" },
                { "company": "Scale VP", "format": "{first_initial}{last}@scalevp.com", "alt": "" },
                { "company": "Storm Ventures", "format": "{first_initial}{last}@stormventures.com", "alt": "" },
                { "company": "Storm", "format": "{first_initial}{last}@stormventures.com", "alt": "" },
                { "company": "Trinity Ventures", "format": "{first}@trinityventures.com", "alt": "" },
                { "company": "Trinity", "format": "{first}@trinityventures.com", "alt": "" },
                { "company": "Venrock", "format": "{first_initial}{last}@venrock.com", "alt": "" },
                { "company": "Vertex US", "format": "{first}@vertexventures.com", "alt": "" },
                { "company": "Vertex", "format": "{first}@vertexventures.com", "alt": "" },
                { "company": "Wing VC", "format": "{first}@wing.vc", "alt": "" },
                { "company": "Wing", "format": "{first}@wing.vc", "alt": "" },
                { "company": "Norwest", "format": "{first_initial}{last}@nvp.com", "alt": "" },
                { "company": "NVP", "format": "{first_initial}{last}@nvp.com", "alt": "" },
                { "company": "Sapphire Ventures", "format": "{first}.{last}@sapphireventures.com", "alt": "" },
                { "company": "Sapphire", "format": "{first}.{last}@sapphireventures.com", "alt": "" },
                { "company": "Goodwater", "format": "{first}@goodwatercap.com", "alt": "" },
                { "company": "Section 32", "format": "{first}@section32.com", "alt": "" },
                { "company": "Mithril", "format": "{first}@mithril.com", "alt": "" },
                { "company": "Formation 8", "format": "{first}@formation8.com", "alt": "" },
                { "company": "Founders Circle", "format": "{first}.{last}@founderscircle.com", "alt": "" },
                { "company": "Industry Ventures", "format": "{first}@industryventures.com", "alt": "" },
                { "company": "Playground Global", "format": "{first}@playground.global", "alt": "" },
                { "company": "Playground", "format": "{first}@playground.global", "alt": "" },
                { "company": "Builders VC", "format": "{first}@builders.vc", "alt": "" },
                { "company": "Builders", "format": "{first}@builders.vc", "alt": "" },
                { "company": "Upfront Ventures", "format": "{first}@upfront.com", "alt": "" },
                { "company": "Upfront", "format": "{first}@upfront.com", "alt": "" },
                { "company": "Slow Ventures", "format": "{first}@slow.co", "alt": "" },
                { "company": "Slow", "format": "{first}@slow.co", "alt": "" },
                { "company": "Tribe Capital", "format": "{first}@tribecap.co", "alt": "" },
                { "company": "Tribe", "format": "{first}@tribecap.co", "alt": "" },
                { "company": "Abstract Ventures", "format": "{first}@abstract.vc", "alt": "" },
                { "company": "Abstract", "format": "{first}@abstract.vc", "alt": "" },
                { "company": "Bedrock", "format": "{first}@bedrockcap.com", "alt": "" },
                { "company": "Contrarian", "format": "{first}@contrarian.com", "alt": "" },
                { "company": "Craft Ventures", "format": "{first}@craftventures.com", "alt": "" },
                { "company": "Craft", "format": "{first}@craftventures.com", "alt": "" },
                { "company": "Definition", "format": "{first}@definition.vc", "alt": "" },
                { "company": "Electric Capital", "format": "{first}@electriccapital.com", "alt": "" },
                { "company": "Electric", "format": "{first}@electriccapital.com", "alt": "" },
                { "company": "Paradigm", "format": "{first}@paradigm.xyz", "alt": "" },
                { "company": "Haun Ventures", "format": "{first}@haun.co", "alt": "" },
                { "company": "Haun", "format": "{first}@haun.co", "alt": "" },
                { "company": "Variant", "format": "{first}@variant.fund", "alt": "" },
                { "company": "Standard Crypto", "format": "{first}@standardcrypto.vc", "alt": "" },
                { "company": "Polychain", "format": "{first}@polychain.capital", "alt": "" },
                { "company": "Pantera", "format": "{first}@panteracapital.com", "alt": "" },

                // === TECH COMPANIES (NON-M7) ===
                { "company": "Uber", "format": "{first}{last}@uber.com", "alt": "{first}.{last}@uber.com" },
                { "company": "Lyft", "format": "{first}@lyft.com", "alt": "" },
                { "company": "DoorDash", "format": "{first}.{last}@doordash.com", "alt": "" },
                { "company": "Instacart", "format": "{first}.{last}@instacart.com", "alt": "" },
                { "company": "Pinterest", "format": "{first}@pinterest.com", "alt": "" },
                { "company": "Snap", "format": "{first}@snap.com", "alt": "" },
                { "company": "Snapchat", "format": "{first}@snap.com", "alt": "" },
                { "company": "Twitter", "format": "{first}@x.com", "alt": "{first}@twitter.com" },
                { "company": "X", "format": "{first}@x.com", "alt": "{first}@twitter.com" },
                { "company": "Reddit", "format": "{first}.{last}@reddit.com", "alt": "" },
                { "company": "Discord", "format": "{first}@discordapp.com", "alt": "{first}@discord.com" },
                { "company": "Twitch", "format": "{first}.{last}@twitch.tv", "alt": "" },
                { "company": "Roblox", "format": "{first}.{last}@roblox.com", "alt": "" },
                { "company": "Epic Games", "format": "{first}.{last}@epicgames.com", "alt": "" },
                { "company": "Epic", "format": "{first}.{last}@epicgames.com", "alt": "" },
                { "company": "Spotify", "format": "{first}{l}@spotify.com", "alt": "" },
                { "company": "Roku", "format": "{first_initial}{last}@roku.com", "alt": "" },
                { "company": "Sonos", "format": "{first}.{last}@sonos.com", "alt": "" },
                { "company": "Peloton", "format": "{first}.{last}@onepeloton.com", "alt": "" },
                { "company": "Garmin", "format": "{first}.{last}@garmin.com", "alt": "" },
                { "company": "GoPro", "format": "{first}.{last}@gopro.com", "alt": "" },
                { "company": "Ring", "format": "{first}.{last}@ring.com", "alt": "" },
                { "company": "Waymo", "format": "{first}.{last}@waymo.com", "alt": "" },
                { "company": "Cruise", "format": "{first}.{last}@getcruise.com", "alt": "" },
                { "company": "Zoox", "format": "{first}.{last}@zoox.com", "alt": "" },
                { "company": "Aurora", "format": "{first}.{last}@aurora.tech", "alt": "" },
                { "company": "Nuro", "format": "{first}.{last}@nuro.ai", "alt": "" },
                { "company": "Rivian", "format": "{first}.{last}@rivian.com", "alt": "" },
                { "company": "Lucid Motors", "format": "{first}.{last}@lucidmotors.com", "alt": "" },
                { "company": "Lucid", "format": "{first}.{last}@lucidmotors.com", "alt": "" },
                { "company": "SpaceX", "format": "{first}.{last}@spacex.com", "alt": "" },
                { "company": "Blue Origin", "format": "{first}.{last}@blueorigin.com", "alt": "" },
                { "company": "Palantir", "format": "{f}{last}@palantir.com", "alt": "" },
                { "company": "C3.ai", "format": "{first}.{last}@c3.ai", "alt": "" },
                { "company": "C3", "format": "{first}.{last}@c3.ai", "alt": "" },
                { "company": "Datadog", "format": "{first}.{last}@datadoghq.com", "alt": "" },
                { "company": "Splunk", "format": "{first_initial}{last}@splunk.com", "alt": "" },
                { "company": "Snowflake", "format": "{first}.{last}@snowflake.com", "alt": "" },
                { "company": "GitLab", "format": "{first_initial}{last}@gitlab.com", "alt": "" },
                { "company": "GitHub", "format": "{first}@github.com", "alt": "" },
                { "company": "Monday.com", "format": "{first}.{last}@monday.com", "alt": "" },
                { "company": "Monday", "format": "{first}.{last}@monday.com", "alt": "" },
                { "company": "Smartsheet", "format": "{first}.{last}@smartsheet.com", "alt": "" },
                { "company": "RingCentral", "format": "{first}.{last}@ringcentral.com", "alt": "" },
                { "company": "Auth0", "format": "{first}.{last}@auth0.com", "alt": "" },
                { "company": "ForgeRock", "format": "{first}.{last}@forgerock.com", "alt": "" },
                { "company": "Check Point", "format": "{first_initial}{last}@checkpoint.com", "alt": "" },
                { "company": "FireEye", "format": "{first}.{last}@trellix.com", "alt": "" },
                { "company": "Trellix", "format": "{first}.{last}@trellix.com", "alt": "" },
                { "company": "Mandiant", "format": "{first}.{last}@mandiant.com", "alt": "" },
                { "company": "Mimecast", "format": "{first}.{last}@mimecast.com", "alt": "" },
                { "company": "Varonis", "format": "{first}.{last}@varonis.com", "alt": "" },
                { "company": "Tenable", "format": "{first_initial}{last}@tenable.com", "alt": "" },
                { "company": "Qualys", "format": "{first_initial}{last}@qualys.com", "alt": "" },
                { "company": "Rapid7", "format": "{first}.{last}@rapid7.com", "alt": "" },
                { "company": "SolarWinds", "format": "{first}.{last}@solarwinds.com", "alt": "" },
                { "company": "Dynatrace", "format": "{first}.{last}@dynatrace.com", "alt": "" },
                { "company": "AppDynamics", "format": "{first}.{last}@appdynamics.com", "alt": "" },
                { "company": "PagerDuty", "format": "{first}.{last}@pagerduty.com", "alt": "" },
                { "company": "Square", "format": "{first}@block.xyz", "alt": "" },
                { "company": "Block", "format": "{first}@block.xyz", "alt": "" },
                { "company": "PayPal", "format": "{first_initial}{last}@paypal.com", "alt": "" },
                { "company": "Adyen", "format": "{first}.{last}@adyen.com", "alt": "" },
                { "company": "Affirm", "format": "{first}.{last}@affirm.com", "alt": "" },
                { "company": "Klarna", "format": "{first}.{last}@klarna.com", "alt": "" },
                { "company": "SoFi", "format": "{first}.{last}@sofi.org", "alt": "{first}.{last}@sofi.com" },
                { "company": "Robinhood", "format": "{first}.{last}@robinhood.com", "alt": "" },
                { "company": "Coinbase", "format": "{first}.{last}@coinbase.com", "alt": "" },
                { "company": "Kraken", "format": "{first}@kraken.com", "alt": "" },
                { "company": "Binance", "format": "{first}@binance.com", "alt": "" },
                { "company": "Opensea", "format": "{first}@opensea.io", "alt": "" },
                { "company": "OpenSea", "format": "{first}@opensea.io", "alt": "" },
                { "company": "Dapper Labs", "format": "{first}@dapperlabs.com", "alt": "" },
                { "company": "Dapper", "format": "{first}@dapperlabs.com", "alt": "" },
                { "company": "Consensys", "format": "{first}.{last}@consensys.net", "alt": "" },
                { "company": "ConsenSys", "format": "{first}.{last}@consensys.net", "alt": "" },
                { "company": "Chainalysis", "format": "{first}.{last}@chainalysis.com", "alt": "" },
                { "company": "Ledger", "format": "{first}.{last}@ledger.com", "alt": "" },
                { "company": "Ripple", "format": "{first}.{last}@ripple.com", "alt": "" },
                { "company": "Circle", "format": "{first}.{last}@circle.com", "alt": "" },
                { "company": "Gemini", "format": "{first}.{last}@gemini.com", "alt": "" },
                { "company": "BitGo", "format": "{first}.{last}@bitgo.com", "alt": "" },
                { "company": "Anchorage Digital", "format": "{first}.{last}@anchorage.com", "alt": "" },
                { "company": "Fireblocks", "format": "{first}@fireblocks.com", "alt": "" },
                { "company": "Paxos", "format": "{first}.{last}@paxos.com", "alt": "" },
                { "company": "Pax", "format": "{first}.{last}@paxos.com", "alt": "" },
                { "company": "Tinder", "format": "{first}@tinder.com", "alt": "" },
                { "company": "Match Group", "format": "{first}.{last}@match.com", "alt": "" },
                { "company": "Match", "format": "{first}.{last}@match.com", "alt": "" },
                { "company": "Bumble", "format": "{first}@team.bumble.com", "alt": "" },
                { "company": "Hinge", "format": "{first}@hinge.co", "alt": "" },
                { "company": "Grindr", "format": "{first}.{last}@grindr.com", "alt": "" },
                { "company": "Duolingo", "format": "{first}@duolingo.com", "alt": "" },
                { "company": "Udemy", "format": "{first}.{last}@udemy.com", "alt": "" },
                { "company": "Coursera", "format": "{first}.{last}@coursera.org", "alt": "" },
                { "company": "Chegg", "format": "{first}.{last}@chegg.com", "alt": "" },
                { "company": "Quizlet", "format": "{first}.{last}@quizlet.com", "alt": "" },
                { "company": "MasterClass", "format": "{first}@masterclass.com", "alt": "" },
                { "company": "Cameo", "format": "{first}@cameo.com", "alt": "" },
                { "company": "Patreon", "format": "{first}@patreon.com", "alt": "" },
                { "company": "Substack", "format": "{first}@substack.com", "alt": "" },
                { "company": "Medium", "format": "{first}.{last}@medium.com", "alt": "" },
                { "company": "Automattic", "format": "{first}@automattic.com", "alt": "" },
                { "company": "Etsy", "format": "{first}{last}@etsy.com", "alt": "" },
                { "company": "Wayfair", "format": "{first_initial}{last}@wayfair.com", "alt": "" },
                { "company": "Chewy", "format": "{first_initial}{last}@chewy.com", "alt": "" },
                { "company": "Zillow", "format": "{first_initial}{last}@zillow.com", "alt": "" },
                { "company": "Redfin", "format": "{first_initial}{last}@redfin.com", "alt": "" },
                { "company": "Opendoor", "format": "{first}.{last}@opendoor.com", "alt": "" },
                { "company": "Compass", "format": "{first}.{last}@compass.com", "alt": "" }
            ];

            try {
                const experienceParts = profileData.experience.split('\n')[0].split(' at ');
                if (experienceParts.length < 2) {
                    Logger.log('Cannot parse company from experience');
                } else {
                    const currentCompany = experienceParts[1].split('(')[0].trim();

                    if (currentCompany && currentCompany.length > 0) {
                        // Find best matching company using fuzzy search
                        let bestMatch = null;
                        let bestScore = 0;

                        for (const item of COMPANY_EMAIL_FORMATS) {
                            const score = fuzzyMatchCompany(currentCompany, item.company);
                            if (score > bestScore && score >= 80) { // Minimum 80% match for strict validation
                                bestScore = score;
                                bestMatch = item;
                            }
                        }

                        const companyMatch = bestMatch;

                        if (companyMatch) {
                            // Sanitize name to handle special characters and diacritics
                            const sanitizedName = sanitizeForEmail(profileData.name);
                            const nameParts = sanitizedName.split(' ').filter(p => p.length > 0 && !p.includes('.'));

                            if (nameParts.length >= 2) {
                                const first = nameParts[0];
                                const last = nameParts[nameParts.length - 1];

                                if (first.length > 0 && last.length > 0) {
                                    // Generate primary email
                                    const primaryEmail = parseEmailFormat(companyMatch.format, first, last);

                                    // Validate the generated email
                                    if (primaryEmail) {
                                        const validation = validateEmailPrediction(primaryEmail, profileData.name);
                                        if (validation.valid) {
                                            predictedEmail = primaryEmail;
                                        } else {
                                            Logger.warn(`Email prediction validation failed: ${validation.reason}`);
                                            Logger.warn(`Generated: ${primaryEmail}, Name: ${profileData.name}`);
                                        }
                                    }

                                    // Generate alternative email for BCC
                                    if (companyMatch.alt) {
                                        const altEmail = parseEmailFormat(companyMatch.alt, first, last);
                                        if (altEmail) {
                                            const altValidation = validateEmailPrediction(altEmail, profileData.name);
                                            if (altValidation.valid) {
                                                predictedBcc = altEmail;
                                            } else {
                                                Logger.warn(`BCC email validation failed: ${altValidation.reason}`);
                                            }
                                        }
                                    }

                                    if (debugMode) {
                                        Logger.log('=== EMAIL PREDICTION ===');
                                        Logger.log('Profile company:', currentCompany);
                                        Logger.log('Matched to:', companyMatch.company);
                                        Logger.log('Match score:', bestScore);
                                        Logger.log('Primary:', predictedEmail);
                                        Logger.log('BCC:', predictedBcc);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                Logger.log('Email prediction failed:', err);
            }
        }

        // Extract company and role for smart caching
        const extractCompanyRole = (experience) => {
            if (!experience) return null;
            const firstLine = experience.split('\n')[0];
            const match = firstLine.match(/^(.+?)\s+at\s+(.+?)(?:\s+\(|$)/);
            if (match) {
                return {
                    role: match[1].trim(),
                    company: match[2].trim()
                };
            }
            return null;
        };

        const companyRole = extractCompanyRole(profileData.experience);

        // Save last generated email for template library
        await chrome.storage.local.set({
            lastGeneratedEmail: {
                subject: emailDraft.subject,
                body: emailDraft.body,
                recipientName: profileData.name,
                recipientHeadline: profileData.headline,
                timestamp: Date.now()
            }
        });

        // Send webhook notification if configured
        const { webhookUrl } = await chrome.storage.local.get('webhookUrl');
        if (webhookUrl) {
            try {
                const webhookPayload = {
                    event: 'email_generated',
                    timestamp: new Date().toISOString(),
                    data: {
                        subject: emailDraft.subject,
                        body: emailDraft.body,
                        recipient: {
                            name: profileData.name,
                            headline: profileData.headline,
                            email: predictedEmail || null,
                            profileUrl: profileData.url || null
                        },
                        metadata: {
                            tone: settings.tone,
                            model: settings.model,
                            includeQuestions: includeQuestions,
                            financeMode: settings.financeRecruitingMode
                        }
                    }
                };

                await fetchWithTimeout(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(webhookPayload)
                }, 10000); // 10s timeout for webhook

                Logger.log('Webhook notification sent successfully');
            } catch (webhookError) {
                // Log error but don't fail the email generation
                Logger.error('Webhook notification failed:', webhookError);
            }
        }

        // Smart caching: Save successful email pattern by company+role
        if (companyRole) {
            const cacheKey = `email_cache_${companyRole.company}_${companyRole.role}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            const { emailPatternCache = {} } = await chrome.storage.local.get('emailPatternCache');

            emailPatternCache[cacheKey] = {
                subject: emailDraft.subject,
                body: emailDraft.body,
                company: companyRole.company,
                role: companyRole.role,
                timestamp: Date.now(),
                expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hour TTL
            };

            // Clean up expired cache entries
            Object.keys(emailPatternCache).forEach(key => {
                if (emailPatternCache[key].expiresAt < Date.now()) {
                    delete emailPatternCache[key];
                }
            });

            await chrome.storage.local.set({ emailPatternCache });
        }

        // --- GMAIL API INTEGRATION ---
        if (debugMode) {
            Logger.log('=== DEBUG MODE: Creating Gmail Draft ===');
            Logger.log('To:', predictedEmail || '(no recipient)');
            Logger.log('Subject:', emailDraft.subject);
            Logger.log('Body:', emailDraft.body);
            Logger.log('=== Proceeding with draft creation ===');
        }

        const token = await getAuthToken();
        const mimeMessage = createMimeMessage(emailDraft.subject, emailDraft.body, predictedEmail, predictedBcc);
        const draft = await createDraft(token, mimeMessage);

        const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${draft.message.id}`;
        chrome.tabs.create({ url: gmailUrl });

        return { success: true };

    } catch (err) {
        Logger.error('Error generating draft:', err);
        return { success: false, error: err.message };
    }
}

async function getAuthToken() {
    // Check persistent cache first
    const { gmailToken, gmailTokenExpiry } = await chrome.storage.local.get(['gmailToken', 'gmailTokenExpiry']);

    if (gmailToken && gmailTokenExpiry && Date.now() < gmailTokenExpiry) {
        Logger.log('Using cached Gmail token');
        return gmailToken;
    }

    Logger.log('Fetching new Gmail token...');

    // Show OAuth notification to user
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'showOAuthNotification' }).catch(() => { });
        }
    } catch (e) {
        Logger.log('Could not show OAuth notification:', e);
    }

    return new Promise((resolve, reject) => {
        const manifest = chrome.runtime.getManifest();
        const clientId = manifest.oauth2.client_id;
        const scopes = manifest.oauth2.scopes.join(' ');

        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${clientId}` +
            `&response_type=token` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(scopes)}`;

        chrome.identity.launchWebAuthFlow(
            { url: authUrl, interactive: true },
            async (responseUrl) => {
                // Hide OAuth notification on all LinkedIn tabs
                try {
                    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { action: 'hideOAuthNotification' }).catch(() => { });
                    });
                } catch (e) {
                    Logger.log('Could not hide OAuth notification:', e);
                }

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                const url = new URL(responseUrl);
                const params = new URLSearchParams(url.hash.substring(1));
                const accessToken = params.get('access_token');
                const expiresIn = params.get('expires_in');

                if (accessToken) {
                    // Persist to storage
                    const expiry = Date.now() + ((parseInt(expiresIn) - 60) * 1000);
                    await chrome.storage.local.set({
                        gmailToken: accessToken,
                        gmailTokenExpiry: expiry
                    });
                    resolve(accessToken);
                } else {
                    reject(new Error('No access token in response'));
                }
            }
        );
    });
}

function createMimeMessage(subject, body, toEmail, bccEmail) {
    const nl = '\r\n';
    let emailContent = [];

    if (toEmail) {
        emailContent.push(`To: ${toEmail}`);
    }

    if (bccEmail) {
        emailContent.push(`Bcc: ${bccEmail}`);
    }

    emailContent.push(`Subject: ${subject}`);
    emailContent.push('Content-Type: text/plain; charset="UTF-8"');
    emailContent.push('MIME-Version: 1.0');
    emailContent.push('');
    emailContent.push(body);

    const joinedContent = emailContent.join(nl);

    return btoa(unescape(encodeURIComponent(joinedContent)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}



async function createDraft(token, rawMessage) {
    const response = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                raw: rawMessage
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error ? data.error.message : 'Failed to create draft');
    }
    return data;
}

// --- CLOUD SYNC LOGIC ---

/**
 * Sync saved profiles to the cloud
 * @param {Array} profiles - List of profiles to sync
 */
async function syncProfilesToCloud(profiles) {
    if (!profiles || profiles.length === 0) return;

    try {
        const gmailToken = await getAuthToken(); // Reuse existing token getter
        if (!gmailToken) return;


        // We send the whole batch for upsert (simple & robust)
        const response = await fetchWithTimeout(`${CONFIG.getApiUrl().replace('/api/generate-email', '/api/sync-profiles')}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gmailToken}`
            },
            body: JSON.stringify({
                action: 'upsert_batch',
                profiles: profiles
            })
        }, 30000);

        if (!response.ok) {
            console.error('Failed to sync profiles:', await response.text());
        } else {
        }
    } catch (e) {
        console.error('Error syncing profiles:', e);
    }
}

// Debounce sync to prevent spamming API
let syncTimer = null;
const debouncedSync = (profiles) => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncProfilesToCloud(profiles);
    }, 2000); // 2 second delay
};

// --- TEMPLATE SYNC LOGIC ---

/**
 * Sync email templates to the cloud
 * @param {Array} templates - List of templates to sync
 */
async function syncTemplatesToCloud(templates) {
    if (!templates || templates.length === 0) return;

    try {
        const gmailToken = await getAuthToken();
        if (!gmailToken) return;


        const response = await fetchWithTimeout(`${CONFIG.getApiUrl().replace('/api/generate-email', '/api/sync-templates')}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gmailToken}`
            },
            body: JSON.stringify({
                action: 'upsert_batch',
                templates: templates
            })
        }, 30000);

        if (!response.ok) {
            console.error('Failed to sync templates:', await response.text());
        } else {
        }
    } catch (e) {
        console.error('Error syncing templates:', e);
    }
}



chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.savedProfiles) {
            const newProfiles = changes.savedProfiles.newValue;
            if (newProfiles) debouncedSync(newProfiles);
        }
    }
});
