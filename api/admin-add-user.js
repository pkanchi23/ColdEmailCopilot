/**
 * Vercel Serverless Function - Admin Add User
 * 
 * Allows admin to add new users to the database with tier selection
 * Protected: Only pranavkanchi23@gmail.com can access
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Verify admin auth
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

        // 2. Validate request body
        const { email, plan_tier } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        const validTiers = ['free', 'paid', 'developer', 'tester'];
        if (!plan_tier || !validTiers.includes(plan_tier.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid plan_tier. Must be: free, paid, developer, or tester' });
        }

        // 3. Add user to database
        const { Pool } = await import('@neondatabase/serverless');
        const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

        try {
            // Check if user already exists
            const existingUser = await pool.query(
                'SELECT email FROM user_profiles WHERE email = $1',
                [email.toLowerCase()]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({ error: 'User already exists' });
            }

            // Insert new user with default values
            await pool.query(`
                INSERT INTO user_profiles (
                    email, 
                    plan_tier,
                    preferred_model,
                    preferred_tone,
                    about_me,
                    example_email,
                    openai_emails_sent,
                    openai_input_tokens,
                    openai_output_tokens,
                    anthropic_emails_sent,
                    anthropic_input_tokens,
                    anthropic_output_tokens,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 0, 0, NOW(), NOW())
            `, [
                email.toLowerCase(),
                plan_tier.toLowerCase(),
                'claude-sonnet-4-20250514',  // Default to Sonnet 4.5
                'Casual & Friendly',          // Default tone
                '',                            // Empty about_me
                ''                             // Empty example_email
            ]);

            return res.status(201).json({
                success: true,
                message: 'User added successfully',
                user: {
                    email: email.toLowerCase(),
                    plan_tier: plan_tier.toLowerCase()
                }
            });

        } finally {
            await pool.end();
        }

    } catch (error) {
        console.error('Admin Add User Error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
