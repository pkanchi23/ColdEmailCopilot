/**
 * Vercel Serverless Function - Sync Saved Profiles
 *
 * Handles upserting and removing saved LinkedIn profiles.
 */

const DEBUG = process.env.DEBUG === 'true';

/**
 * Verify Google OAuth token and extract email
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
        if (DEBUG) console.error('Token verification error:', error);
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

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // 1. Auth
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
        }
        const tokenInfo = await verifyGoogleToken(authHeader.substring(7));
        if (!tokenInfo.isValid) {
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
        }
        const userEmail = tokenInfo.email;

        // 2. DB Init and check user exists
        const { Pool } = await import('@neondatabase/serverless');
        const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

        try {
            const userExists = await checkUserExists(userEmail, pool);
            if (!userExists) {
                return res.status(403).json({ error: 'Forbidden', message: 'User not in database' });
            }

            // 3. Handle Actions
            const { action, profiles, url } = req.body;

            if (action === 'upsert_batch') {
                if (!profiles || !Array.isArray(profiles)) {
                    return res.status(400).json({ error: 'Bad Request', message: 'profiles array required for batch upsert' });
                }

                for (const p of profiles) {
                    if (!p.url) continue;

                    await pool.query(`
                        INSERT INTO saved_profiles (user_email, linkedin_url, name, headline, location, about, list_name, raw_data, captured_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                        ON CONFLICT (user_email, linkedin_url) 
                        DO UPDATE SET
                            name = EXCLUDED.name,
                            headline = EXCLUDED.headline,
                            location = EXCLUDED.location,
                            about = EXCLUDED.about,
                            list_name = EXCLUDED.list_name,
                            raw_data = EXCLUDED.raw_data,
                            captured_at = NOW();
                    `, [
                        userEmail,
                        p.url,
                        p.name || '',
                        p.headline || '',
                        p.location || '',
                        p.about || '',
                        p.list || 'default',
                        JSON.stringify(p)
                    ]);
                }
                return res.status(200).json({ success: true, count: profiles.length });

            } else if (action === 'delete') {
                if (!url) return res.status(400).json({ error: 'Bad Request', message: 'url required for delete' });

                await pool.query(`DELETE FROM saved_profiles WHERE user_email = $1 AND linkedin_url = $2`, [userEmail, url]);
                return res.status(200).json({ success: true, deleted: url });
            } else {
                return res.status(400).json({ error: 'Bad Request', message: 'Invalid action' });
            }

        } catch (dbError) {
            console.error('Database error:', dbError);
            return res.status(500).json({ error: 'Database error', message: dbError.message });
        } finally {
            await pool.end();
        }

    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
