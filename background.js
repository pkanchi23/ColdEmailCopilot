// --- Token Caching ---
let cachedToken = null;
let tokenExpiry = null;

// --- Web Grounding Helper ---
async function performWebSearch(profileData, anthropicApiKey) {
    // Construct search query based on profile
    const company = profileData.experience?.split('\n')[0]?.split(' at ')[1]?.split('(')[0]?.trim();
    const name = profileData.name;

    if (!company || !name) {
        return null;
    }

    const searchQuery = `${name} ${company} news recent funding portfolio`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5',
                max_tokens: 500,
                messages: [{
                    role: 'user',
                    content: `Search for recent news about ${name} at ${company}. Focus on: funding rounds, new portfolio companies (if VC), product launches, or career moves. If nothing recent/relevant found, say "NO_RELEVANT_NEWS". Be very concise (2-3 sentences max).`
                }],
                tools: [{
                    type: 'web_search_20241101'
                }]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('Web search error:', data.error);
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
        console.error('Web search failed:', error);
        return null;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateDraft') {
        handleGenerateDraft(request.data)
            .then(sendResponse)
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
});

async function handleGenerateDraft(requestData) {
    try {
        const profileData = requestData.profile;
        const specialInstructions = requestData.instructions || '';
        let dynamicSenderName = requestData.senderName;
        const includeQuestions = requestData.includeQuestions || false;
        const useWebGrounding = requestData.useWebGrounding || false;

        const {
            openAiApiKey,
            anthropicApiKey,
            userContext,
            senderName: storedSenderName,
            model = 'gpt-5.2',
            tone = 'Casual & Friendly',
            exampleEmail,
            financeRecruitingMode = false,
            debugMode = false
        } = await chrome.storage.local.get(['openAiApiKey', 'anthropicApiKey', 'userContext', 'senderName', 'model', 'tone', 'exampleEmail', 'financeRecruitingMode', 'debugMode']);

        const finalSenderName = dynamicSenderName || storedSenderName || 'Your Name';

        if (!openAiApiKey && !anthropicApiKey) {
            throw new Error('No API Key found. Please set at least one key in extension options.');
        }

        // Debug mode logging
        if (debugMode) {
            console.log('=== DEBUG MODE ===');
            console.log('Profile Data:', profileData);
            console.log('Sender Name:', finalSenderName);
            console.log('User Context:', userContext);
            console.log('Model:', model);
            console.log('Tone:', tone);
            console.log('Finance Mode:', financeRecruitingMode);
        }

        // Extract first name for signature
        const firstName = finalSenderName.split(' ')[0];

        // Perform web search if Web Grounding is enabled
        let webGroundingContext = null;
        if (useWebGrounding && model.startsWith('claude-') && anthropicApiKey) {
            if (debugMode) {
                console.log('=== WEB GROUNDING ENABLED ===');
            }
            webGroundingContext = await performWebSearch(profileData, anthropicApiKey);
            if (debugMode && webGroundingContext) {
                console.log('Web Grounding Result:', webGroundingContext);
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
                    console.log('=== CACHED PATTERN FOUND ===');
                    console.log('Company:', cachedPattern.company);
                    console.log('Role:', cachedPattern.role);
                    console.log('Cached Subject:', cachedPattern.subject);
                }
            }
        }

        // Shared question formatting rules (used by both modes)
        const questionFormattingRules = `QUESTION FORMAT: Compact numbered list with NO blank lines between items. Format as:
Two things I'm curious about:
1. First question here...
2. Second question here...
NOT:
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
      1. Intro: Casual introduction with name, role, background (1 sentence). CRITICAL: ABSOLUTELY NO "Name here -" format (e.g., "Pranav here -", "John here -", etc.). This is FORBIDDEN. Start directly like: "I'm [Name], [role/context]..."
      2. Connection: Find SPECIFIC points of intersection between YOUR journey and THEIRS. Make them think "this person really gets it."
      ${includeQuestions ? `3. Transition + 2-3 questions: "I wanted to ask for your advice:" then compact numbered list with NO blank lines. Questions must reference SPECIFIC details from their profile (companies, roles, transitions, timeframes).` : '3. Ask for a quick call'}
      4. Closing: Ask for a quick call (NOT "15 mins", just "quick call"). Acknowledge busy schedule, thank sincerely. NEVER offer coffee.

      SUBJECT: State your PURPOSE for reaching out (e.g., "Advice on moving from banking to operating", "Question about transitioning to growth equity"). NEVER just describe their career move (NOT "PWP to Duolingo Move"). Be formal/direct.
      TONE: Professional, respectful, intellectually curious. Show you did research.

      ${includeQuestions ? `QUESTIONS (2-3 only if highly relevant):
      - These questions are CRITICAL - they make your email engaging and hard to ignore
      - MUST reference SPECIFIC details: actual company names, specific role transitions, specific timeframes from their experience
      - FORBIDDEN: Generic questions that could apply to anyone. Questions MUST be rooted in their specific career arc
      - DEPTH MATTERS: Questions should reveal you've thought deeply about their decisions. Show analytical thinking, not surface-level curiosity.
      - Ask about decisions/trade-offs using their ACTUAL experiences, NOT "what is it like"
      - Focus on CAREER and WORK decisions - NEVER mention compensation, comp, salary, or money
      - AVOID ASSUMPTIONS: Don't assume they're "ramping up" or "getting up to speed" unless they just started (<3 months). Check tenure carefully.
      - SENIORITY: Don't ask basic questions of senior people (MDs/Partners/VPs) - they expect depth and analytical thinking.
      Good: "Your move from Goldman Sachs IB to Sequoia (after 2.5 years) - what made you confident enough to jump then vs staying for VP?" / "You joined consumer VC right when the category was out of favor - what made you confident in the timing vs waiting for the cycle?"
      Bad: "What's it like?" / "Any advice?" / "How did you get into [field]?" / "How's the new role going?" / Any vague question / Any mention of compensation/money` : ''}
      TIMING & PRECISION: Don't say "recently started/joined" unless <3 months ago. NEVER make assumptions about their current state (e.g., "swamped getting up to speed", "settling in", "ramping up") - you don't know this. Stick to facts from their profile.
      TONE: Always polite, respectful, and non-offensive. Never pushy or entitled.
      FORMAT: Paragraph breaks between sections${includeQuestions ? `, ${questionFormattingRules}` : ''}. Sign: "Best, ${firstName}"
        ` : '';

        // Build Question Mode instructions (for non-finance mode)
        const questionInstructions = includeQuestions ? `
      QUESTION MODE (1-3 questions):
      - CRITICAL: Questions make your email engaging and hard to ignore
      - MUST reference SPECIFIC details: actual company names, specific role transitions, specific timeframes from their experience
      - FORBIDDEN: Generic questions that could apply to anyone. Questions MUST be rooted in their specific career arc
      - DEPTH MATTERS: Questions should reveal you've thought deeply about their decisions. Show analytical thinking, not surface-level curiosity.
      - Ask about decisions/trade-offs using their ACTUAL experiences, NOT "what is it like"
      - Focus on CAREER and WORK - NEVER mention compensation, comp, salary, or money
      - AVOID ASSUMPTIONS: Don't assume their current state (e.g., "ramping up", "settling in") unless they just started (<3 months)
      - SENIORITY: Don't ask basic questions of senior people (MDs/Partners/VPs) - they expect depth and analytical thinking.
      - Be concise, specific to THEIR journey. Skip if no highly pertinent question.
      ${questionFormattingRules}
      Good: "Your move from Stripe to 20-person startup (after 4 years) - how did you think about stability vs ownership?" / "You joined consumer VC right when the category was out of favor - what made you confident in the timing?"
      Bad: "Pick your brain?" / "Any advice?" / "What's it like?" / "How's the new gig?" / Any vague question / Any mention of compensation` : '';

        const prompt = `
      You're a real person (NOT marketer/salesperson) writing a genuine cold email.

      CRITICAL RULES:
      1. ABSOLUTELY NO "Name here -" format (e.g., "Pranav here -"). Start like: "I'm [Name], [role/context]..."
      2. Questions MUST use SPECIFIC details (actual company names, roles, timeframes) from their profile. FORBIDDEN: generic questions.
      3. NO FALSE PRECISION: Don't assume their current state ("swamped", "ramping up") unless factual. Check tenure.
      4. BE CONCISE: Don't recite their career history back to them. Only reference specific details as needed for context/connection points.
      5. TITLE ACCURACY: Use their ACTUAL title/role from their LinkedIn profile. Don't make up or paraphrase job titles.
      6. STRONG OPENING: First sentence must grab attention with a specific decision/transition, NOT generic observations.
         Bad: "I saw you work at Stripe and wanted to reach out"
         Good: "Your decision to leave MBB for a pre-PMF startup caught my eye"
      7. SHOW RESEARCH, DON'T TELL: Never say "I did my research" or "I've been following your work" or "impressed by your career". Just demonstrate it through specific references. No flattery.
         Bad: "I've been impressed by your career trajectory"
         Good: "Your pivot from sell-side to growth equity after only 18 months suggests..."
      8. QUESTION DEPTH: Questions should reveal you've thought deeply about their decisions. Show analytical thinking, not surface-level curiosity.
         Bad: "What made you switch to VC?"
         Good: "You joined Sequoia right when consumer was out of favor (2022) - what made you confident in the timing vs waiting for the cycle?"
      9. SENIORITY AWARENESS: Adjust tone for seniority. Don't be too casual with MDs/Partners/VPs. Don't ask basic questions of senior people - they expect depth.

      RECIPIENT:
      Name: ${profileData.name}
      Headline: ${profileData.headline}
      ${profileData.location ? `Location: ${profileData.location}` : ''}
      ${profileData.education ? `Education: ${profileData.education}` : ''}
      About: ${profileData.about}
      Experience (chronological): ${profileData.experience}

      Analyze FULL career trajectory (patterns, transitions, story arc), not just current role.

      SENDER: ${userContext || 'Not provided'}

      ${webGroundingContext ? `RECENT NEWS / CONTEXT (use if highly relevant to build connection):
      ${webGroundingContext}

      WEB GROUNDING USAGE: Only mention if it creates a genuine connection point (e.g., "congrats on the raise", "saw portfolio company X", "noticed your recent launch"). NEVER force it if not naturally relevant. Skip entirely if unclear or generic.` : ''}

      CTA RULE: ALWAYS ask for a quick call. NEVER offer coffee. Say "quick call" not "15-min call" or specific durations.

      ${specialInstructions ? `SPECIAL: ${specialInstructions}` : ''}
      ${exampleEmail ? `STYLE REF (match vibe): ${exampleEmail}` : ''}

      WARM CONNECTION: If we know each other (mentor/colleague/met before), reconnect naturally. Don't formally intro or explain relationship robotically.
      Bad: "I was your mentee..." Good: "Been a while since [event]! Hope you've been well."

      SPARSE PROFILE: If limited data (minimal About, 1-2 experiences), focus on what exists, ask to learn more, keep shorter/open-ended.

      ${financeInstructions}

      ${questionInstructions}

      TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
      GOAL: Make this email SO ENGAGING it's hard to ignore. Find specific points of intersection. Ask questions they're uniquely positioned to answer. Make them think "this person really gets it."

      Write like a human (no jargon, natural not robotic).

      ${financeRecruitingMode ? '' : `CASUAL MODE:
      1. Use ALL experiences - find pivots/patterns/story arc. DON'T recite their career history - only reference specifics as needed for connection points.
      2. Short punchy sentences. Conversational but professional (like respected colleague).
      3. CRITICAL: ABSOLUTELY NO "Name here -" introduction format (e.g., "Pranav here -", "John here -"). This is FORBIDDEN. Start directly like: "I'm [Name], [role/context]..."
      4. STRONG OPENING: First sentence must grab attention with specific decision/transition. NO generic observations like "I saw you work at..."
      5. CRITICAL - Find SPECIFIC points of intersection using ACTUAL details from their profile (company names, roles, timeframes): What makes them WANT to talk with you? Find shared struggles, career tensions, deep connection (YOUR journey with THEIR journey). Mutual curiosity, not sales. Make it engaging and hard to ignore.
         Bad: "I saw you work at Stripe. Interested in fintech."
         Better: "Your move from Goldman to Series A caught my eye - wrestling with similar decision."
         Best: "Your decision to leave banking after 3yrs for a pre-PMF startup caught my eye - been at JPM thinking about that same jump."
      6. SHOW RESEARCH, DON'T TELL: Never say "I did my research" or "impressed by your career". Just demonstrate it through specific references. No flattery.
      7. CTA: Ask for a quick call. Say "quick call" NOT "15-min call" or specific durations. NEVER offer coffee. Acknowledge busy schedule.
      8. TONE: Always polite, respectful, and non-offensive. Never pushy or entitled. Thoughtful and genuine. Adjust for seniority - more formal with senior folks.
      9. NEVER mention compensation, comp, salary, or money in any context.
      10. AVOID FALSE PRECISION: Don't make assumptions about their current state (e.g., "swamped getting up to speed", "settling in"). Stick to facts from their profile.
      11. USE ACTUAL TITLES: Reference their exact job titles from LinkedIn. Don't paraphrase or make up titles.
      `}

      ${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
      SUBJECT: State YOUR PURPOSE for reaching out (e.g., "Advice on moving from banking to operating", "Question about growth equity transition"). NEVER just describe their career move. Never: "Quick Question"/"Reaching Out"/"Coffee?"/"[A] to [B] move"`}

      FORMAT: ${financeRecruitingMode ? (includeQuestions ? '125-150' : '100-125') : (includeQuestions ? '125-150' : '75-100')} words. Standard ASCII only (straight quotes/hyphens, no curly/em-dash). Return JSON: {"subject": "...", "body": "..."}
      ALMA MATER: Never mention their school unless sender attended SAME one.
    `;

        // Debug logging for prompt
        if (debugMode) {
            console.log('=== FULL PROMPT ===');
            console.log(prompt);
            console.log('==================');
        }

        let content;

        // --- ANTHROPIC / CLAUDE API CALL ---
        if (model.startsWith('claude-')) {
            if (!anthropicApiKey) {
                throw new Error('Claude API Key missing. Please set it in options.');
            }

            // Split prompt into cacheable (static instructions) and dynamic (profile data)
            const staticInstructions = `You're a real person (NOT marketer/salesperson) writing a genuine cold email.

CRITICAL RULES:
1. ABSOLUTELY NO "Name here -" format (e.g., "Pranav here -"). Start like: "I'm [Name], [role/context]..."
2. Questions MUST use SPECIFIC details (actual company names, roles, timeframes) from their profile. FORBIDDEN: generic questions.
3. NO FALSE PRECISION: Don't assume their current state ("swamped", "ramping up") unless factual. Check tenure.
4. BE CONCISE: Don't recite their career history back to them. Only reference specific details as needed for context/connection points.
5. TITLE ACCURACY: Use their ACTUAL title/role from their LinkedIn profile. Don't make up or paraphrase job titles.
6. STRONG OPENING: First sentence must grab attention with a specific decision/transition, NOT generic observations.
   Bad: "I saw you work at Stripe and wanted to reach out"
   Good: "Your decision to leave MBB for a pre-PMF startup caught my eye"
7. SHOW RESEARCH, DON'T TELL: Never say "I did my research" or "I've been following your work" or "impressed by your career". Just demonstrate it through specific references. No flattery.
   Bad: "I've been impressed by your career trajectory"
   Good: "Your pivot from sell-side to growth equity after only 18 months suggests..."
8. QUESTION DEPTH: Questions should reveal you've thought deeply about their decisions. Show analytical thinking, not surface-level curiosity.
   Bad: "What made you switch to VC?"
   Good: "You joined Sequoia right when consumer was out of favor (2022) - what made you confident in the timing vs waiting for the cycle?"
9. SENIORITY AWARENESS: Adjust tone for seniority. Don't be too casual with MDs/Partners/VPs. Don't ask basic questions of senior people - they expect depth.

CTA RULE: ALWAYS ask for a quick call. NEVER offer coffee. Say "quick call" not "15-min call" or specific durations.

WARM CONNECTION: If we know each other (mentor/colleague/met before), reconnect naturally. Don't formally intro or explain relationship robotically.
Bad: "I was your mentee..." Good: "Been a while since [event]! Hope you've been well."

SPARSE PROFILE: If limited data (minimal About, 1-2 experiences), focus on what exists, ask to learn more, keep shorter/open-ended.

${financeInstructions}

${questionInstructions}

TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
GOAL: Make this email SO ENGAGING it's hard to ignore. Find specific points of intersection. Ask questions they're uniquely positioned to answer. Make them think "this person really gets it."

Write like a human (no jargon, natural not robotic).

${financeRecruitingMode ? '' : `CASUAL MODE:
1. Use ALL experiences - find pivots/patterns/story arc. DON'T recite their career history - only reference specifics as needed for connection points.
2. Short punchy sentences. Conversational but professional (like respected colleague).
3. CRITICAL: ABSOLUTELY NO "Name here -" introduction format (e.g., "Pranav here -", "John here -"). This is FORBIDDEN. Start directly like: "I'm [Name], [role/context]..."
4. STRONG OPENING: First sentence must grab attention with specific decision/transition. NO generic observations like "I saw you work at..."
5. CRITICAL - Find SPECIFIC points of intersection using ACTUAL details from their profile (company names, roles, timeframes): What makes them WANT to talk with you? Find shared struggles, career tensions, deep connection (YOUR journey with THEIR journey). Mutual curiosity, not sales. Make it engaging and hard to ignore.
   Bad: "I saw you work at Stripe. Interested in fintech."
   Better: "Your move from Goldman to Series A caught my eye - wrestling with similar decision."
   Best: "Your decision to leave banking after 3yrs for a pre-PMF startup caught my eye - been at JPM thinking about that same jump."
6. SHOW RESEARCH, DON'T TELL: Never say "I did my research" or "impressed by your career". Just demonstrate it through specific references. No flattery.
7. CTA: Ask for a quick call. Say "quick call" NOT "15-min call" or specific durations. NEVER offer coffee. Acknowledge busy schedule.
8. TONE: Always polite, respectful, and non-offensive. Never pushy or entitled. Thoughtful and genuine. Adjust for seniority - more formal with senior folks.
9. NEVER mention compensation, comp, salary, or money in any context.
10. AVOID FALSE PRECISION: Don't make assumptions about their current state (e.g., "swamped getting up to speed", "settling in"). Stick to facts from their profile.
11. USE ACTUAL TITLES: Reference their exact job titles from LinkedIn. Don't paraphrase or make up titles.
`}

${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
SUBJECT: State YOUR PURPOSE for reaching out (e.g., "Advice on moving from banking to operating", "Question about growth equity transition"). NEVER just describe their career move. Never: "Quick Question"/"Reaching Out"/"Coffee?"/"[A] to [B] move"`}

FORMAT: ${financeRecruitingMode ? (includeQuestions ? '125-150' : '100-125') : (includeQuestions ? '125-150' : '75-100')} words. Standard ASCII only (straight quotes/hyphens, no curly/em-dash). Return JSON: {"subject": "...", "body": "..."}
ALMA MATER: Never mention their school unless sender attended SAME one.`;

            const dynamicContent = `RECIPIENT:
Name: ${profileData.name}
Headline: ${profileData.headline}
${profileData.location ? `Location: ${profileData.location}` : ''}
${profileData.education ? `Education: ${profileData.education}` : ''}
About: ${profileData.about}
Experience (chronological): ${profileData.experience}

Analyze FULL career trajectory (patterns, transitions, story arc), not just current role.

SENDER: ${userContext || 'Not provided'}

${webGroundingContext ? `RECENT NEWS / CONTEXT (use if highly relevant to build connection):
${webGroundingContext}

WEB GROUNDING USAGE: Only mention if it creates a genuine connection point (e.g., "congrats on the raise", "saw portfolio company X", "noticed your recent launch"). NEVER force it if not naturally relevant. Skip entirely if unclear or generic.` : ''}

${specialInstructions ? `SPECIAL: ${specialInstructions}` : ''}
${exampleEmail ? `STYLE REF (match vibe): ${exampleEmail}` : ''}
${cachedPattern ? `\n\nSUCCESSFUL PATTERN (for similar ${cachedPattern.role} at ${cachedPattern.company}):\nSubject: ${cachedPattern.subject}\nBody structure (adapt, don't copy): ${cachedPattern.body.substring(0, 200)}...` : ''}`;

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': anthropicApiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
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
                })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }
            content = data.content[0].text;
        }
        // --- OPENAI API CALL ---
        else {
            if (!openAiApiKey) {
                throw new Error('OpenAI API Key missing. Please set it in options.');
            }

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openAiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: prompt }],
                    response_format: { type: "json_object" }
                })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }
            content = data.choices[0].message.content;
        }

        let emailDraft;
        try {
            // Remove markdown code blocks if present (common with Claude)
            let cleanContent = content.trim();
            if (cleanContent.startsWith('```json')) {
                cleanContent = cleanContent.replace(/^```json/, '').replace(/```$/, '');
            } else if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.replace(/^```/, '').replace(/```$/, '');
            }
            emailDraft = JSON.parse(cleanContent);
        } catch (e) {
            console.warn('JSON parsing failed, using raw content:', e);
            emailDraft = { subject: "Intro", body: content };
        }

        // Debug logging for generated draft
        if (debugMode) {
            console.log('=== GENERATED DRAFT ===');
            console.log('Subject:', emailDraft.subject);
            console.log('Body:', emailDraft.body);
            console.log('====================');
        }

        // --- EMAIL PREDICTION LOGIC ---
        let predictedEmail = null;
        if (financeRecruitingMode && profileData.experience && profileData.name) {
            const FINANCE_DOMAINS = {
                "Goldman Sachs": { domain: "gs.com", format: "first.last" },
                "Morgan Stanley": { domain: "morganstanley.com", format: "first.last" },
                "J.P. Morgan": { domain: "jpmorgan.com", format: "first.last" },
                "Bank of America": { domain: "bofa.com", format: "first.last" },
                "Citi": { domain: "citi.com", format: "first.last" },
                "Barclays": { domain: "barclays.com", format: "first.last" },
                "UBS": { domain: "ubs.com", format: "first.last" },
                "Deutsche Bank": { domain: "db.com", format: "first.last" },
                "Evercore": { domain: "evercore.com", format: "first.last" },
                "Centerview": { domain: "centerview.com", format: "flast" },
                "Lazard": { domain: "lazard.com", format: "first.last" },
                "PJT Partners": { domain: "pjtpartners.com", format: "first.last" },
                "Moelis & Co.": { domain: "moelis.com", format: "first.last" },
                "Qatalyst Partners": { domain: "qatalyst.com", format: "first.last" },
                "Guggenheim": { domain: "guggenheimpartners.com", format: "first.last" },
                "Perella Weinberg": { domain: "pwpartners.com", format: "flast" },
                "Jefferies": { domain: "jefferies.com", format: "flast" },
                "Houlihan Lokey": { domain: "hl.com", format: "flast" },
                "William Blair": { domain: "williamblair.com", format: "flast" },
                "RBC Capital Mkts": { domain: "rbccm.com", format: "first.last" },
                "RBC": { domain: "rbccm.com", format: "first.last" },
                "BMO Capital Mkts": { domain: "bmo.com", format: "first.last" },
                "BMO": { domain: "bmo.com", format: "first.last" },
                "Piper Sandler": { domain: "psc.com", format: "first.last" },
                "Raymond James": { domain: "raymondjames.com", format: "first.last" },
                "Rothschild & Co": { domain: "rothschildandco.com", format: "first.last" },
                "Stifel": { domain: "stifel.com", format: "lastf" },
                "Wells Fargo": { domain: "wellsfargo.com", format: "first.last" }
            };

            const currentCompany = profileData.experience.split('\n')[0].split(' at ')[1]; // Heuristic to get company
            if (currentCompany) {
                // Find matching company
                const companyKey = Object.keys(FINANCE_DOMAINS).find(key =>
                    currentCompany.toLowerCase().includes(key.toLowerCase()) ||
                    key.toLowerCase().includes(currentCompany.toLowerCase())
                );

                if (companyKey) {
                    const { domain, format } = FINANCE_DOMAINS[companyKey];
                    const nameParts = profileData.name.toLowerCase().split(' ').filter(p => !p.includes('.')); // Remove titles like "Mr." if simple split
                    // Basic name parsing (first last)
                    if (nameParts.length >= 2) {
                        const first = nameParts[0].replace(/[^a-z]/g, '');
                        const last = nameParts[nameParts.length - 1].replace(/[^a-z]/g, '');

                        if (format === 'first.last') predictedEmail = `${first}.${last}@${domain}; xxxx`;
                        else if (format === 'flast') predictedEmail = `${first[0]}${last}@${domain}; xxxx`;
                        else if (format === 'lastf') predictedEmail = `${last}${first[0]}@${domain}; xxxx`;
                    }
                }
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
            console.log('=== DEBUG MODE: Skipping Gmail ===');
            console.log('Draft would have been created with:');
            console.log('To:', predictedEmail || '(no recipient)');
            console.log('Subject:', emailDraft.subject);
            console.log('Body:', emailDraft.body);
            return { success: true, debug: true };
        }

        const token = await getAuthToken();
        const mimeMessage = createMimeMessage(emailDraft.subject, emailDraft.body, predictedEmail);
        const draft = await createDraft(token, mimeMessage);

        const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${draft.message.id}`;
        chrome.tabs.create({ url: gmailUrl });

        return { success: true };

    } catch (err) {
        console.error('Error generating draft:', err);
        return { success: false, error: err.message };
    }
}

async function getAuthToken() {
    // Check persistent cache first
    const { gmailToken, gmailTokenExpiry } = await chrome.storage.local.get(['gmailToken', 'gmailTokenExpiry']);

    if (gmailToken && gmailTokenExpiry && Date.now() < gmailTokenExpiry) {
        console.log('Using cached Gmail token');
        return gmailToken;
    }

    console.log('Fetching new Gmail token...');
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

function createMimeMessage(subject, body, toEmail) {
    const nl = '\r\n';
    let emailContent = [];

    if (toEmail) {
        emailContent.push(`To: ${toEmail}`);
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
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
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
