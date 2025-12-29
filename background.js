// --- Token Caching ---
let cachedToken = null;
let tokenExpiry = null;

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
        const questionFormattingRules = `QUESTION FORMAT: Compact numbered list (1. Question... 2. Question...) with no blank lines between.`;

        // Build Finance Recruiting specific instructions
        const financeInstructions = financeRecruitingMode ? `
      FINANCE MODE (${includeQuestions ? '125-150' : '100-125'} words):
      GOAL: Email so thoughtful they feel compelled to respond.

      ANALYSIS (use ALL profile data):
      - Use multiple specific details (roles, transitions, career trajectory)
      - Analyze patterns/pivots across their full career arc
      - Connect YOUR background to THEIRS analytically
      - No fluff like "I came across your profile..." - jump to specific connection
      - Ex: "Your [Company A]→[Company B] move suggests you prioritized [X]. I'm building [X] at..."

      STRUCTURE:
      1. Intro: Name, role, background (1 sentence)
      2. Connection: Specific details from profile, analytical link to your journey
      ${includeQuestions ? `3. Transition + 2-3 questions: "I wanted to ask for your advice:" then compact numbered list` : '3. Ask to connect briefly'}
      4. Closing: Express openness, acknowledge busy schedule, thank sincerely

      SUBJECT: Formal/direct (e.g., "Incoming IB Analyst Seeking Advice", "Question from Fellow [School] Alum"). Never casual.
      TONE: Professional, respectful, intellectually curious. Show you did research.

      ${includeQuestions ? `QUESTIONS (2-3 only if highly relevant):
      - Must show UNIQUE INSIGHT from their specific path + STRONG tie to your context
      - Ask about decisions/trade-offs, NOT "what is it like"
      - Must be concise and specific to THEIR journey
      - Skip if no highly pertinent question exists - just ask for chat
      Examples: "When did shift from 'executing' to 'owning outcomes' happen?" / "How reversible did [specific choice] feel?" / "What was overrated about [path stage]?"
      Bad: "What's it like?" / "Any advice?" / "How did you get into [field]?"` : ''}
      TIMING: Don't say "recently started/joined" unless <1yr ago. Skip if unclear.
      FORMAT: Paragraph breaks between sections${includeQuestions ? `, ${questionFormattingRules}` : ''}. Sign: "Best, ${firstName}"
        ` : '';

        // Build Question Mode instructions (for non-finance mode)
        const questionInstructions = includeQuestions ? `
      QUESTION MODE (1-3 questions):
      - Only if they have UNIQUE INSIGHT + STRONG tie to your context
      - Ask about decisions/trade-offs, NOT "what is it like"
      - Must sit at intersection of THEIR path + YOUR context
      - Be concise, specific to THEIR journey. Skip if no highly pertinent question.
      ${questionFormattingRules}
      Examples: "How did you balance [trade-off]?" / "Biggest surprise in [transition]?" / "Your [A]→[B] move suggests [X] - how did you decide?"
      Bad: "Pick your brain?" / "Any advice?" / "What's it like?"` : '';

        const prompt = `
      You're a real person (NOT marketer/salesperson) writing a genuine cold email.

      RECIPIENT:
      Name: ${profileData.name}
      Headline: ${profileData.headline}
      ${profileData.location ? `Location: ${profileData.location}` : ''}
      ${profileData.education ? `Education: ${profileData.education}` : ''}
      About: ${profileData.about}
      Experience (chronological): ${profileData.experience}

      Analyze FULL career trajectory (patterns, transitions, story arc), not just current role.

      SENDER: ${userContext || 'Not provided'}

      LOCATION CTA: Coffee/in-person if same city (check locations). Otherwise: call/Zoom. Never suggest coffee if locations differ/unclear.

      ${specialInstructions ? `SPECIAL: ${specialInstructions}` : ''}
      ${exampleEmail ? `STYLE REF (match vibe): ${exampleEmail}` : ''}

      WARM CONNECTION: If we know each other (mentor/colleague/met before), reconnect naturally. Don't formally intro or explain relationship robotically.
      Bad: "I was your mentee..." Good: "Been a while since [event]! Hope you've been well."

      SPARSE PROFILE: If limited data (minimal About, 1-2 experiences), focus on what exists, ask to learn more, keep shorter/open-ended.

      ${financeInstructions}

      ${questionInstructions}

      TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
      GOAL: ${financeRecruitingMode ? 'Career advice + potential call' : '15-min intro call'}

      Write like a human (no jargon, natural not robotic).

      ${financeRecruitingMode ? '' : `CASUAL MODE:
      1. Use ALL experiences - find pivots/patterns/story arc. Reference specific transitions.
      2. Short punchy sentences. Conversational but professional (like respected colleague).
      3. Core insight: What makes them WANT coffee with you? Find shared struggles, career tensions, deep connection (YOUR journey ↔ THEIR journey). Mutual curiosity, not sales.
         Bad: "I saw you work at Stripe. Interested in fintech."
         Better: "Your Goldman→Series A move caught my eye - wrestling with similar decision."
         Best: "Your banking→startup post hit home. JPM 3yrs, 'golden handcuffs' keeps me up. How did you think through math vs mission?"
      4. CTA: Specific (15-min call/coffee/advice), low-commitment, acknowledge busy. Follow location rules (coffee only if same location).
      `}

      ${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
      SUBJECT: "[A]→[B] move" / "Question about [specific]" / "Fellow [shared] with question". Reference insight, match tone. Never: "Quick Question"/"Reaching Out"/"Coffee?"`}

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

LOCATION CTA: Coffee/in-person if same city (check locations). Otherwise: call/Zoom. Never suggest coffee if locations differ/unclear.

WARM CONNECTION: If we know each other (mentor/colleague/met before), reconnect naturally. Don't formally intro or explain relationship robotically.
Bad: "I was your mentee..." Good: "Been a while since [event]! Hope you've been well."

SPARSE PROFILE: If limited data (minimal About, 1-2 experiences), focus on what exists, ask to learn more, keep shorter/open-ended.

${financeInstructions}

${questionInstructions}

TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
GOAL: ${financeRecruitingMode ? 'Career advice + potential call' : '15-min intro call'}

Write like a human (no jargon, natural not robotic).

${financeRecruitingMode ? '' : `CASUAL MODE:
1. Use ALL experiences - find pivots/patterns/story arc. Reference specific transitions.
2. Short punchy sentences. Conversational but professional (like respected colleague).
3. Core insight: What makes them WANT coffee with you? Find shared struggles, career tensions, deep connection (YOUR journey ↔ THEIR journey). Mutual curiosity, not sales.
   Bad: "I saw you work at Stripe. Interested in fintech."
   Better: "Your Goldman→Series A move caught my eye - wrestling with similar decision."
   Best: "Your banking→startup post hit home. JPM 3yrs, 'golden handcuffs' keeps me up. How did you think through math vs mission?"
4. CTA: Specific (15-min call/coffee/advice), low-commitment, acknowledge busy. Follow location rules (coffee only if same location).
`}

${financeRecruitingMode ? '' : `SIGNATURE: Best, ${firstName}
SUBJECT: "[A]→[B] move" / "Question about [specific]" / "Fellow [shared] with question". Reference insight, match tone. Never: "Quick Question"/"Reaching Out"/"Coffee?"`}

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

                        if (format === 'first.last') predictedEmail = `${first}.${last}@${domain}xxxx`;
                        else if (format === 'flast') predictedEmail = `${first[0]}${last}@${domain}xxxx`;
                        else if (format === 'lastf') predictedEmail = `${last}${first[0]}@${domain}xxxx`;
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
