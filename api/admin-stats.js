/**
 * Vercel Serverless Function - Admin Global Stats
 * Returns all user profiles and their usage.
 * Protected by Google Auth (only pranavkanchi23@gmail.com).
 */

const ALLOWED_ADMIN = 'pranavkanchi23@gmail.com';

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

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.substring(7);
    const auth = await verifyGoogleToken(token);

    if (!auth.isValid) {
        return res.status(401).json({ error: 'Invalid Google Token' });
    }

    if (auth.email !== ALLOWED_ADMIN) {
        return res.status(403).json({ error: 'Forbidden: You are not the admin.' });
    }

    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

    try {
        const result = await pool.query(`
        SELECT 
            email, plan_tier, 
            openai_emails_sent, openai_input_tokens, openai_output_tokens,
            anthropic_emails_sent, anthropic_input_tokens, anthropic_output_tokens,
            updated_at, created_at
        FROM user_profiles
        ORDER BY updated_at DESC
    `);

        return res.status(200).json({
            users: result.rows,
            count: result.rowCount
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    } finally {
        await pool.end();
    }
}
