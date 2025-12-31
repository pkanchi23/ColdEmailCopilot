/**
 * Vercel Serverless Function - Update User Settings
 *
 * This function:
 * 1. Verifies the user's Google OAuth token
 * 2. Checks if their email exists in the database
 * 3. Updates their profile settings in Postgres
 */

// Enable/disable debug logging
const DEBUG = process.env.DEBUG === 'true';

/**
 * Verify Google OAuth token and extract email
 */
async function verifyGoogleToken(accessToken) {
    try {
        const response = await fetch(
            `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`
        );

        if (!response.ok) {
            throw new Error('Invalid token');
        }

        const data = await response.json();

        if (!data.email || !data.verified_email) {
            throw new Error('Token does not contain verified email');
        }

        return {
            email: data.email,
            isValid: true
        };
    } catch (error) {
        if (DEBUG) console.error('Token verification error:', error);
        return {
            email: null,
            isValid: false,
            error: error.message
        };
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

/**
 * Main handler function
 */
export default async function handler(req, res) {
    // Enable CORS for Chrome extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed',
            message: 'Only POST requests are supported'
        });
    }

    try {
        // 1. Extract and verify Google OAuth token
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing or invalid Authorization header. Expected: Bearer <token>'
            });
        }

        const accessToken = authHeader.substring(7);

        if (DEBUG) console.log('Verifying token...');

        const tokenInfo = await verifyGoogleToken(accessToken);

        if (!tokenInfo.isValid) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid Google OAuth token',
                details: tokenInfo.error
            });
        }

        const userEmail = tokenInfo.email;
        if (DEBUG) console.log('Authenticated user:', userEmail);

        // 2. Connect to DB and check if user exists
        const { Pool } = await import('@neondatabase/serverless');
        const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

        try {
            const userExists = await checkUserExists(userEmail, pool);

            if (!userExists) {
                if (DEBUG) console.log('User not in database:', userEmail);
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Your email address is not authorized to use this service',
                    email: userEmail
                });
            }

            // 3. Update Profile in Postgres
            const {
                userContext: aboutMe,
                exampleEmail,
                generalInstructions,
                tone: preferredTone,
                model: preferredModel
            } = req.body;

            const query = `
                INSERT INTO user_profiles (email, about_me, example_email, general_instructions, preferred_tone, preferred_model)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (email) DO UPDATE SET
                    about_me = COALESCE(EXCLUDED.about_me, user_profiles.about_me),
                    example_email = COALESCE(EXCLUDED.example_email, user_profiles.example_email),
                    general_instructions = COALESCE(EXCLUDED.general_instructions, user_profiles.general_instructions),
                    preferred_tone = COALESCE(EXCLUDED.preferred_tone, user_profiles.preferred_tone),
                    preferred_model = COALESCE(EXCLUDED.preferred_model, user_profiles.preferred_model),
                    updated_at = NOW()
                RETURNING plan_tier;
            `;

            const result = await pool.query(query, [
                userEmail,
                aboutMe || null,
                exampleEmail || null,
                generalInstructions || null,
                preferredTone || null,
                preferredModel || null
            ]);

            return res.status(200).json({
                message: 'Settings saved successfully',
                plan: result.rows[0]?.plan_tier || 'free'
            });

        } catch (dbError) {
            console.error('Database Error:', dbError);
            return res.status(500).json({
                error: 'Database Error',
                message: 'Failed to save settings to database'
            });
        } finally {
            await pool.end();
        }

    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
