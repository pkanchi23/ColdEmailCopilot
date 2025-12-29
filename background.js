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
            financeRecruitingMode = false
        } = await chrome.storage.local.get(['openAiApiKey', 'anthropicApiKey', 'userContext', 'senderName', 'model', 'tone', 'exampleEmail', 'financeRecruitingMode']);

        const finalSenderName = dynamicSenderName || storedSenderName || 'Your Name';

        if (!openAiApiKey && !anthropicApiKey) {
            throw new Error('No API Key found. Please set at least one key in extension options.');
        }
        // Extract first name for signature
        const firstName = finalSenderName.split(' ')[0];

        // Build Finance Recruiting specific instructions
        const financeInstructions = financeRecruitingMode ? `
      FINANCE RECRUITING MODE - FORMAL NETWORKING EMAIL:
      
      THE GOAL: Write an email SO thoughtful and insightful that the recipient feels almost COMPELLED to respond. They should think: "This person really did their homework. I want to talk to them."
      
      This email must be CONCISE but THOUGHTFUL (100-150 words). Be respectful of their time.
      
      BE EXTREMELY ANALYTICAL & THOUGHTFUL:
      - **MAXIMIZE PROFILE USAGE**: You MUST use multiple specific details from their LinkedIn profile (specific deals, roles, transitions, universities, volunteer work). The more specific data points, the better.
      - **CONNECT THE DOTS**: Do not just list shared facts. Analyze HOW your background connects to theirs. 
      - **AVOID FLUFF**: Never say things like "I came across your profile because you are doing the work I am about to start..." -> This is low signal. Instead, jump straight into the specific connection.
      - **BRIDGE THE GAP**: Example: "You went from [Company A] to [Company B] implies you prioritized [Skill X]. I am currently building [Skill X] at [My Company] and..."
      
      STRUCTURE:
      1. INTRODUCTION: Concisely state your name, role, and background (1 sentence).
      2. CONNECTION: Connect your background to theirs using SPECIFIC details from their profile. Why does their specific path matter to you? Be analytical.
      ${includeQuestions ? `3. TRANSITION & QUESTIONS:
         - Write a transition sentence: "I wanted to reach out and ask for your advice on a few questions:"
         - Then list 2-3 thoughtful questions as a NUMBERED LIST.
         - IMPORTANT: Put each question on a NEW LINE.` : '3. Ask to connect briefly to learn from their experience.'}
      ${includeQuestions ? '4' : '4'}. CLOSING: Express openness to a call but acknowledge they may be busy. Thank them sincerely.
      
      SUBJECT LINE:
      - Formal and direct (e.g., "Incoming IB Analyst Seeking Advice", "Question from a Fellow [School] Alum")
      - Never casual or clickbait-y
      
      TONE:
      - Professional and respectful, not casual
      - Slightly deferential but not sycophantic
      - Demonstrate intellectual curiosity and genuine interest in THEIR perspective
      - Show you've done your research
      
      ${includeQuestions ? `QUESTION GUIDELINES:
      - Questions should be about LESSONS LEARNED and CAREER ADVICE, not job-specific or technical finance questions
      - Focus on how their unique background and decisions relate to YOUR situation
      
      GOLD STANDARD QUESTION EXAMPLES (Use these as inspiration only - adapt to their specific background):
      ${(() => {
                    const pool = [
                        "How did the expectations on you change moving from Analyst 1 to Analyst 2, and what was the hardest adjustment?",
                        "At what point did you feel the job shift from 'executing work' to 'owning outcomes,' and what triggered that shift?",
                        "Looking back, what behaviors mattered most for being seen as 'reliable' early on versus 'trusted' later?",
                        "How did you think about choosing industry coverage versus a product group early on, and how reversible did that decision feel?",
                        "In practice, how much does deep industry knowledge really compound versus being excellent at a core product like M&A or LevFin?",
                        "For someone starting in coverage, what’s the fastest way to build real industry judgment versus just learning the buzzwords?",
                        "Did you ever feel pigeonholed by your group choice, and if so, how did you manage that internally?",
                        "How do strong coverage bankers differentiate themselves once product execution becomes table stakes?"
                    ];
                    // Provide 3 random examples to keep the model fresh
                    const shuffled = pool.sort(() => 0.5 - Math.random());
                    return shuffled.slice(0, 3).map(q => `- "${q}"`).join('\n      ');
                })()}
      
      - Good: "How do you think about impact within your career?" or "Looking back, what skills would you focus on improving during [stage]?"
      - Good: "What do you think was overrated during [path]? I feel like there's a lot of 'conventional wisdom' that isn't always the best advice."
      - Bad: "What's your take on current deal flow?" or "How do you evaluate companies?" (too job-specific)
      - Avoid generic questions like "Any advice?" or "How did you get into finance?"
      ` : ''}
      TIMING RULE:
      - Do NOT mention that someone "recently started" or "just joined" unless they started less than 1 year ago
      - If start date is unclear, do not reference recency at all
      
      FORMATTING:
      - Use proper paragraph breaks between sections
      ${includeQuestions ? `- QUESTIONS MUST BE FORMATTED AS A NUMBERED LIST:
        1. Question one...
        2. Question two...
        3. Question three...
        (Ensure there are newlines between questions for readability)` : ''}
      - Sign off with "Best," and first name only
        ` : '';

        // Build Question Mode instructions
        const questionInstructions = includeQuestions ? `
      QUESTION MODE ENABLED:
      Include 1-3 thoughtful, high-quality questions in the email.
      
      QUESTION RULES:
      - Questions should show genuine intellectual curiosity
      - They should be specific to THIS person's unique journey/decisions
      - They should be questions YOU actually want answered
      - Frame the email around asking these questions
      - End with "would love to hop on a call to discuss" or similar
      
      QUESTION EXAMPLES (adapt to this person):
      - "How did you think about the tradeoff between stability at [Big Corp] vs. the upside at [Startup]?"
      - "What surprised you most about the transition from [Role A] to [Role B]?"
      - "I'm curious how you balanced [specific challenge] -- any frameworks that helped?"
      
      BAD QUESTIONS (avoid):
      - "Can I pick your brain?" (too vague)
      - "What do you do?" (lazy, they already wrote it)
      - "Any advice?" (too broad)
        ` : '';

        const prompt = `
      You are a human writing a genuine, personal cold email. NOT a marketer. NOT a salesperson. Just a real person reaching out.

      RECIPIENT:
      Name: ${profileData.name}
      Headline: ${profileData.headline}
      About: ${profileData.about}
      Recent Experience: ${profileData.experience}

      SENDER CONTEXT:
      ${userContext || 'Not provided'}

      ${specialInstructions ? `SPECIAL INSTRUCTIONS:\n${specialInstructions}` : ''}

      ${exampleEmail ? `STYLE REFERENCE (match the vibe, not the words):\n${exampleEmail}` : ''}

      ${financeInstructions}

      ${questionInstructions}

      TONE: ${financeRecruitingMode ? 'Professional & Formal' : tone}
      GOAL: ${financeRecruitingMode ? 'Get career advice and potentially a call' : 'Get a 15-minute intro call'}.

      ALWAYS WRITE LIKE A HUMAN:
      - No corporate jargon or buzzwords
      - Sound natural, not robotic

      ${financeRecruitingMode ? '' : `CASUAL MODE RULES:
      - Keep sentences short and punchy
      - Sound like you're texting a professional friend

      FIND THE CORE INSIGHT:
      Think: "What would make this person actually WANT to grab coffee with me?"
      - Look for shared struggles, not just shared interests
      - Find the tension or inflection point in their career
      - Connect YOUR journey to THEIR journey at a deeper level
      - The goal is mutual curiosity, not a sales pitch

      EXAMPLES OF DEPTH:

         SURFACE LEVEL (BAD):
         "I saw you work at Stripe. I'm interested in fintech too."

         BETTER:
         "Your move from Goldman to that Series A caught my eye -- I'm wrestling with a similar decision."

         BEST (INSIGHT-DRIVEN):
         "Reading your post about leaving banking for startups hit home. I've been at JPM for 3 years and the 'golden handcuffs' debate keeps me up at night. Would love to hear how you thought through the math vs. the mission tradeoff."

         Another example:
         SURFACE: "You went to Wharton and work in PE."
         INSIGHT: "Your path from Wharton to ops at that growth fund is uncommon -- most of your classmates probably went portco or banking. I'm curious what made you bet on the operator side early."
      `}

      4. SIGNATURE:
         Best,
         ${firstName}

      5. SUBJECT LINE:
         ${financeRecruitingMode ? '- Formal and direct (e.g., "Incoming IB Analyst Seeking Advice")' : '- Reference the specific insight, not generic interest'}
         - Match the tone
         - Never use "Quick Question", "Reaching Out", or "Coffee?"

      6. FORMATTING:
         - ${financeRecruitingMode ? '100-150 words' : 'Under 100 words'}
         - NEVER use special characters like curly quotes, em-dashes, or fancy apostrophes
         - Use only standard ASCII: straight quotes ('), double hyphens (--)
         - Return JSON: {"subject": "...", "body": "..."}

      7. ALMA MATER RULE:
         - NEVER mention the recipient's college, university, or school unless the sender (user context) attended the SAME institution
         - Only reference shared alma mater as a connection point, never just theirs
    `;

        let content;

        // --- ANTHROPIC / CLAUDE API CALL ---
        if (model.startsWith('claude-')) {
            if (!anthropicApiKey) {
                throw new Error('Claude API Key missing. Please set it in options.');
            }

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': anthropicApiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true' // Requesting from extension
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: 1024,
                    messages: [{ role: "user", content: prompt }],
                    system: "You are a helpful assistant that outputs only JSON."
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

                        if (format === 'first.last') predictedEmail = `${first}.${last}@${domain}`;
                        else if (format === 'flast') predictedEmail = `${first[0]}${last}@${domain}`;
                        else if (format === 'lastf') predictedEmail = `${last}${first[0]}@${domain}`;
                    }
                }
            }
        }

        // --- GMAIL API INTEGRATION ---
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
