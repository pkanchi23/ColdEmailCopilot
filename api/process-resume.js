/**
 * Vercel Serverless Function - Process Resume & Generate Profile
 * 
 * Accepts resume upload, extracts text, generates "About Me" using AI
 */

// Enable/disable debug logging
const DEBUG = process.env.DEBUG === 'true';

async function verifyGoogleToken(accessToken) {
    try {
        const response = await fetch(
            `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`
        );
        if (!response.ok) throw new Error('Invalid token');
        const data = await response.json();
        if (!data.email || !data.verified_email) throw new Error('Token does not contain verified email');
        return { email: data.email, isValid: true };
    } catch (error) {
        return { email: null, isValid: false, error: error.message };
    }
}

/**
 * Check if user exists in database
 */
async function checkUserExists(email, pool) {
    const result = await pool.query(
        'SELECT email FROM user_profiles WHERE email = $1',
        [email.toLowerCase()]
    );
    return result.rows.length > 0;
}

// Parse multipart form data (simple implementation for small files)
async function parseMultipart(req) {
    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) throw new Error('No boundary found');

    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const text = buffer.toString('utf-8');

    const parts = text.split(`--${boundary}`);

    for (const part of parts) {
        if (part.includes('filename=')) {
            const filenameMatch = part.match(/filename="([^"]+)"/);
            const filename = filenameMatch ? filenameMatch[1] : 'unknown';

            const contentStart = part.indexOf('\r\n\r\n');
            if (contentStart === -1) continue;

            const contentEnd = part.lastIndexOf('\r\n--');
            const content = part.substring(contentStart + 4, contentEnd > 0 ? contentEnd : undefined);

            return { filename, content };
        }
    }

    throw new Error('No file found in upload');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const accessToken = authHeader.substring(7);
        const tokenInfo = await verifyGoogleToken(accessToken);

        if (!tokenInfo.isValid) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const userEmail = tokenInfo.email;

        // 2. Check user exists in database
        const { Pool } = await import('@neondatabase/serverless');
        const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

        try {
            // Auto-provision new users with free tier (same as generate-email.js)
            const ensureUserQuery = `
                INSERT INTO user_profiles (email, plan_tier)
                VALUES ($1, 'free')
                ON CONFLICT (email) DO NOTHING;
            `;
            await pool.query(ensureUserQuery, [userEmail]);

            if (DEBUG) console.log('User ensured in database:', userEmail);

            // 3. Parse file upload
            let resumeText = '';

            try {
                const { filename, content } = await parseMultipart(req);

                if (filename.toLowerCase().endsWith('.txt')) {
                    resumeText = content.trim();
                } else if (filename.toLowerCase().endsWith('.pdf')) {
                    const pdfParse = (await import('pdf-parse')).default;
                    const pdfBuffer = Buffer.from(content, 'binary');
                    const pdfData = await pdfParse(pdfBuffer);
                    resumeText = pdfData.text.trim();
                } else {
                    return res.status(400).json({ error: 'Unsupported file type. Use .txt or .pdf' });
                }

                if (!resumeText || resumeText.length < 50) {
                    return res.status(400).json({ error: 'Resume text too short or empty' });
                }
            } catch (parseError) {
                console.error('Parse error:', parseError);
                return res.status(400).json({ error: 'Failed to parse resume file', details: parseError.message });
            }

            // 4. Generate profile using AI
            const systemPrompt = `SYSTEM PROMPT: Sender Profile Extraction (Hybrid A+B, 500-word cap)

You are an expert analyst tasked with constructing a compact but high-signal sender profile from a resume and any supplemental context. Your output will be used by another model to write highly personalized cold emails.

Your goal is not to summarize the resume line-by-line, but to reconstruct the person behind it in a way that enables overlap detection, narrative hooks, and credible outreach.

HARD CONSTRAINTS
- Max 500 words total (both sections combined).
- Two sections only, clearly separated with headers.
- Use bullets, prioritize signal density.
- No fluff, no generic praise.
- Section 1 must be strictly resume-grounded (no inferred motivations).

SECTION 1 — PHYSICAL / FACTUAL HISTORY (Resume-grounded dossier)

Reconstruct the subject's professional and extracurricular history with high-level detail only. Keep each role to 1–2 bullets max.

Include:
- Identity snapshot: Name, current role, current firm, geography, career stage
- Education: Institutions, degrees/concentrations, dates, GPA (if present), 3–6 signal-bearing courses
- Leadership & orgs: Student orgs + roles (compress; avoid long explanations)
- Professional experience (chronological)
- Skills & fluencies: Technical + finance tools (compressed)
- Credentials / anchors: Awards/recognitions; notable brands/firms/deals (compressed)

SECTION 2 — PSYCHOLOGICAL / NARRATIVE HISTORY (Interpretive, pattern-grounded)

Infer how the person thinks and what they optimize for, grounded in patterns from Section 1. Keep this section to ~200–250 words.

Include (bullets, compact):
1. Core Through-Lines (recurring themes across roles)
2. Intellectual Orientation (execution vs systems vs hybrid; evidence-based)
3. Motivations & Tensions (e.g., building vs evaluating; speed vs rigor)
4. Overlap Vectors (for cold outreach) (industries, roles, transitions, stages, problem spaces)
5. Tone & Positioning Guidance (how to sound; what to assume vs earn; what to avoid)

OUTPUT REQUIREMENTS
- Clear headers + bullet points.
- Two sections only.
- Stay under 500 words.`;

            const userPrompt = `Here is the resume:\n\n${resumeText}`;

            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) {
                return res.status(500).json({ error: 'Server configuration error' });
            }

            const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': anthropicKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 2048,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }]
                })
            });

            const anthropicData = await anthropicResponse.json();

            if (!anthropicResponse.ok || anthropicData.error) {
                console.error('Anthropic error:', anthropicData);
                return res.status(500).json({ error: 'AI processing failed', details: anthropicData.error?.message });
            }

            const generatedProfile = anthropicData.content[0].text;

            // 5. Save to database
            await pool.query(`
                UPDATE user_profiles 
                SET 
                    resume_text = $2,
                    resume_uploaded_at = NOW(),
                    user_context = $3,
                    updated_at = NOW()
                WHERE email = $1
            `, [userEmail, resumeText, generatedProfile]);

            return res.status(200).json({
                success: true,
                generated_profile: generatedProfile,
                resume_length: resumeText.length
            });

        } finally {
            await pool.end();
        }

    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
