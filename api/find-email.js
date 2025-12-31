/**
 * Vercel Serverless Function - Email Lookup Waterfall
 *
 * Waterfall approach:
 * 1. Company database pattern matching (free, instant)
 * 2. Apollo.io API fallback (opt-in, requires consent)
 * 3. Return null if nothing found
 */

const DEBUG = process.env.DEBUG === 'true';

// Email patterns database (loaded from JSON)
let emailPatterns = null;

/**
 * Load email patterns from JSON file
 */
async function loadEmailPatterns() {
    if (emailPatterns) return emailPatterns;

    try {
        // In Vercel, we need to use dynamic import or read from file
        const fs = await import('fs');
        const path = await import('path');
        const patternsPath = path.join(process.cwd(), 'data', 'email-patterns.json');
        const data = fs.readFileSync(patternsPath, 'utf8');
        emailPatterns = JSON.parse(data);
        return emailPatterns;
    } catch (error) {
        console.error('Failed to load email patterns:', error);
        // Fallback to minimal patterns
        return {
            "default": { "pattern": "{first}.{last}", "confidence": "low" }
        };
    }
}

/**
 * Extract company domain from company name or LinkedIn URL
 */
function extractDomain(company, linkedinUrl) {
    // Try to extract from company name (simple heuristic)
    if (company) {
        // Common patterns: "Google", "Goldman Sachs", "JP Morgan Chase"
        const normalized = company.toLowerCase()
            .replace(/[^a-z0-9]/g, '')  // Remove spaces and special chars
            .replace(/inc$|corp$|llc$|ltd$|plc$/g, '');  // Remove corp suffixes

        // Map common company names to domains
        const domainMappings = {
            'google': 'google.com',
            'amazon': 'amazon.com',
            'microsoft': 'microsoft.com',
            'apple': 'apple.com',
            'meta': 'meta.com',
            'facebook': 'facebook.com',
            'netflix': 'netflix.com',
            'goldmansachs': 'goldmansachs.com',
            'jpmorgan': 'jpmorganchase.com',
            'jpmorganchase': 'jpmorganchase.com',
            'morganstanley': 'morganstanley.com',
            'bankofamerica': 'bankofamerica.com',
            'citi': 'citi.com',
            'citigroup': 'citi.com',
            'barclays': 'barclays.com',
            'blackrock': 'blackrock.com',
            'blackstone': 'blackstone.com',
            'mckinsey': 'mckinsey.com',
            'bcg': 'bcg.com',
            'bain': 'bain.com',
            'deloitte': 'deloitte.com',
            'pwc': 'pwc.com',
            'ey': 'ey.com',
            'kpmg': 'kpmg.com',
            'accenture': 'accenture.com'
        };

        if (domainMappings[normalized]) {
            return domainMappings[normalized];
        }

        // Try simple domain guess: companyname.com
        return `${normalized}.com`;
    }

    return null;
}

/**
 * Parse name into first and last name components
 */
function parseName(fullName) {
    if (!fullName) return { first: '', last: '' };

    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
        return { first: parts[0].toLowerCase(), last: '' };
    }

    return {
        first: parts[0].toLowerCase(),
        last: parts[parts.length - 1].toLowerCase()
    };
}

/**
 * Generate email from pattern
 */
function generateEmailFromPattern(pattern, firstName, lastName, domain) {
    let email = pattern
        .replace('{first}', firstName)
        .replace('{last}', lastName)
        .replace('{f}', firstName.charAt(0))
        .replace('{l}', lastName.charAt(0));

    // If pattern doesn't include domain, add it
    if (!email.includes('@')) {
        email = `${email}@${domain}`;
    }

    return email;
}

/**
 * Try company pattern matching
 */
async function tryCompanyPattern(name, company) {
    const patterns = await loadEmailPatterns();
    const domain = extractDomain(company);

    if (!domain) {
        if (DEBUG) console.log('No domain extracted from company:', company);
        return null;
    }

    const { first, last } = parseName(name);

    if (!first) {
        if (DEBUG) console.log('Could not parse name:', name);
        return null;
    }

    // Look up pattern for this domain
    const domainPattern = patterns[domain] || patterns['default'];

    const email = generateEmailFromPattern(domainPattern.pattern, first, last, domain);

    if (DEBUG) console.log(`Pattern match: ${email} (${domainPattern.confidence}) for ${domain}`);

    return {
        email,
        source: 'pattern',
        confidence: domainPattern.confidence,
        domain
    };
}

/**
 * Apollo.io API lookup (fallback)
 */
async function apolloLookup(name, company) {
    const apolloApiKey = process.env.APOLLO_API_KEY;

    if (!apolloApiKey) {
        if (DEBUG) console.log('Apollo API key not configured');
        return null;
    }

    try {
        const response = await fetch('https://api.apollo.io/v1/people/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'x-api-key': apolloApiKey
            },
            body: JSON.stringify({
                name: name,
                organization_name: company,
                reveal_personal_emails: false
            })
        });

        if (!response.ok) {
            console.error('Apollo API error:', response.status, await response.text());
            return null;
        }

        const data = await response.json();

        if (data.person && data.person.email) {
            return {
                email: data.person.email,
                source: 'apollo',
                confidence: 'high'
            };
        }

        return null;
    } catch (error) {
        console.error('Apollo lookup error:', error);
        return null;
    }
}

/**
 * Verify Google OAuth token
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

/**
 * Main handler
 */
export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const tokenInfo = await verifyGoogleToken(authHeader.substring(7));
        if (!tokenInfo.isValid) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Extract request data
        const { name, company, linkedinUrl, apolloEnabled } = req.body;

        if (!name || !company) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'name and company are required'
            });
        }

        if (DEBUG) {
            console.log(`Email lookup for: ${name} at ${company}`);
        }

        // Step 1: Try company pattern matching
        const patternResult = await tryCompanyPattern(name, company);
        if (patternResult && patternResult.confidence !== 'low') {
            return res.status(200).json({
                success: true,
                ...patternResult
            });
        }

        // Step 2: Try Apollo.io if enabled
        if (apolloEnabled) {
            const apolloResult = await apolloLookup(name, company);
            if (apolloResult) {
                return res.status(200).json({
                    success: true,
                    ...apolloResult
                });
            }
        }

        // Step 3: Return pattern result even if low confidence, or null
        if (patternResult) {
            return res.status(200).json({
                success: true,
                ...patternResult,
                warning: 'Low confidence pattern match'
            });
        }

        // No email found
        return res.status(200).json({
            success: false,
            email: null,
            source: null,
            message: 'Could not determine email address'
        });

    } catch (error) {
        console.error('Find email error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
}
