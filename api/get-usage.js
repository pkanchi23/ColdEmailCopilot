/**
 * Vercel Serverless Function - Get User Usage & Spend
 *
 * Returns:
 * - Current Plan Tier
 * - Token Usage (OpenAI vs Anthropic)
 * - Calculated Spend
 * - Spend Limit
 */

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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const tokenInfo = await verifyGoogleToken(authHeader.substring(7));
        if (!tokenInfo.isValid) return res.status(401).json({ error: 'Invalid token' });
        const userEmail = tokenInfo.email;

        // DB Connection
        const { Pool } = await import('@neondatabase/serverless');
        const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

        try {
            const userRes = await pool.query(`
                SELECT 
                    plan_tier, 
                    openai_input_tokens, openai_output_tokens, openai_emails_sent,
                    anthropic_input_tokens, anthropic_output_tokens, anthropic_emails_sent,
                    updated_at
                FROM user_profiles 
                WHERE email = $1
            `, [userEmail]);

            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const user = userRes.rows[0];
            const planTier = user.plan_tier || 'free';

            // Pricing
            const PRICES = {
                gpt_input: 1.75,
                gpt_output: 14.00,
                claude_input: 3.00,
                claude_output: 15.00
            };

            const openaiCost =
                ((parseInt(user.openai_input_tokens || 0) / 1000000) * PRICES.gpt_input) +
                ((parseInt(user.openai_output_tokens || 0) / 1000000) * PRICES.gpt_output);

            const anthropicCost =
                ((parseInt(user.anthropic_input_tokens || 0) / 1000000) * PRICES.claude_input) +
                ((parseInt(user.anthropic_output_tokens || 0) / 1000000) * PRICES.claude_output);

            const totalSpend = openaiCost + anthropicCost;

            // Limits
            const LIMITS = {
                'free': 2.00,
                'developer': 20.00,
                'paid': 10.00,
                'tester': 10.00
            };
            const limit = LIMITS[planTier.toLowerCase()] || 20.00;

            return res.status(200).json({
                plan: planTier,
                spend: {
                    total: totalSpend,
                    limit: limit,
                    openai: openaiCost,
                    anthropic: anthropicCost,
                    percentage: Math.min((totalSpend / limit) * 100, 100)
                },
                usage: {
                    openai: {
                        input: parseInt(user.openai_input_tokens || 0),
                        output: parseInt(user.openai_output_tokens || 0),
                        emails: parseInt(user.openai_emails_sent || 0)
                    },
                    anthropic: {
                        input: parseInt(user.anthropic_input_tokens || 0),
                        output: parseInt(user.anthropic_output_tokens || 0),
                        emails: parseInt(user.anthropic_emails_sent || 0)
                    }
                }
            });

        } finally {
            await pool.end();
        }

    } catch (error) {
        console.error('Get Usage Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
