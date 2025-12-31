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
 * Normalize company name for matching
 */
function normalizeCompanyName(company) {
    if (!company) return '';
    return company.toLowerCase()
        .replace(/[^a-z0-9]/g, '')  // Remove spaces and special chars
        .replace(/inc$|corp$|llc$|ltd$|plc$/g, '');  // Remove corp suffixes
}

/**
 * Fuzzy match company name against pattern database
 * Returns the best matching domain from the database
 */
function fuzzyMatchCompany(company, patterns) {
    const normalized = normalizeCompanyName(company);
    if (!normalized) return null;

    // First: Try exact match on domain key
    for (const domain in patterns) {
        if (domain === 'default') continue;
        const domainBase = domain.replace(/\.com$|\.io$|\.ai$/i, '');
        if (domainBase === normalized) {
            if (DEBUG) console.log(`Exact domain match: ${normalized} -> ${domain}`);
            return domain;
        }
    }

    // Second: Try fuzzy match on domain keywords
    // e.g., "goldman sachs" should match "goldmansachs.com"
    for (const domain in patterns) {
        if (domain === 'default') continue;
        const domainBase = domain.replace(/\.com$|\.io$|\.ai$/i, '');

        // Check if normalized company name contains domain base or vice versa
        if (normalized.includes(domainBase) || domainBase.includes(normalized)) {
            // Prefer longer matches (more specific)
            if (normalized.length >= 3 && domainBase.length >= 3) {
                if (DEBUG) console.log(`Fuzzy match: ${normalized} -> ${domain}`);
                return domain;
            }
        }
    }

    // Third: Check common abbreviations/aliases
    const aliases = {
        'gs': 'goldmansachs.com',
        'jp': 'jpmorganchase.com',
        'jpm': 'jpmorganchase.com',
        'ms': 'morganstanley.com',
        'bofa': 'bankofamerica.com',
        'fb': 'facebook.com',
        'hg': 'hg.com'
    };

    if (aliases[normalized]) {
        if (DEBUG) console.log(`Alias match: ${normalized} -> ${aliases[normalized]}`);
        return aliases[normalized];
    }

    // No match found - will use default pattern
    return null;
}

/**
 * Extract company domain from company name or LinkedIn URL
 */
function extractDomain(company, linkedinUrl, patterns) {
    if (!company) return null;

    // Try fuzzy matching against pattern database first
    const fuzzyMatch = fuzzyMatchCompany(company, patterns);
    if (fuzzyMatch) {
        return fuzzyMatch;
    }

    // Fallback: Try simple domain guess: companyname.com
    const normalized = normalizeCompanyName(company);
    return normalized ? `${normalized}.com` : null;
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
    const domain = extractDomain(company, null, patterns);

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
async function apolloLookup(name, company, linkedinUrl) {
    const apolloApiKey = process.env.APOLLO_API_KEY;

    if (!apolloApiKey) {
        if (DEBUG) console.log('Apollo API key not configured');
        return null;
    }

    try {
        const requestBody = {
            name: name,
            organization_name: company,
            reveal_personal_emails: false
        };

        // Add LinkedIn URL if available for better matching
        if (linkedinUrl) {
            requestBody.linkedin_url = linkedinUrl;
        }

        console.log('=== APOLLO API CALL ===');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch('https://api.apollo.io/v1/people/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'x-api-key': apolloApiKey
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Apollo response status:', response.status);
        const responseText = await response.text();
        console.log('Apollo response body:', responseText);

        if (!response.ok) {
            console.error('Apollo API error - Status:', response.status);
            console.error('Apollo API error - Body:', responseText);
            return null;
        }

        const data = JSON.parse(responseText);
        console.log('Apollo parsed data:', JSON.stringify(data, null, 2));

        if (data.person && data.person.email) {
            console.log('✓ Apollo found email:', data.person.email);
            return {
                email: data.person.email,
                source: 'apollo',
                confidence: 'high'
            };
        }

        console.log('✗ Apollo returned data but no email found');
        console.log('Person object:', data.person);
        return null;
    } catch (error) {
        console.error('Apollo lookup exception:', error.message);
        console.error('Apollo error stack:', error.stack);
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

        // Track waterfall steps for debugging
        const waterfallSteps = [];

        // Step 1: Try company pattern matching
        const patternResult = await tryCompanyPattern(name, company);

        if (patternResult) {
            waterfallSteps.push({
                step: 'pattern_match',
                result: patternResult.confidence === 'low' ? 'fallback' : 'matched',
                email: patternResult.email,
                domain: patternResult.domain,
                confidence: patternResult.confidence
            });
        }

        if (patternResult && patternResult.confidence !== 'low') {
            return res.status(200).json({
                success: true,
                ...patternResult,
                waterfall: waterfallSteps
            });
        }

        // Step 2: Try Apollo.io if enabled
        let apolloAttempted = false;
        let apolloResult = null;

        if (apolloEnabled) {
            apolloAttempted = true;
            apolloResult = await apolloLookup(name, company, linkedinUrl);

            waterfallSteps.push({
                step: 'apollo',
                result: apolloResult ? 'found' : 'not_found',
                email: apolloResult?.email || null
            });

            if (apolloResult) {
                return res.status(200).json({
                    success: true,
                    ...apolloResult,
                    waterfall: waterfallSteps
                });
            }
        } else {
            waterfallSteps.push({
                step: 'apollo',
                result: 'skipped',
                reason: 'not_enabled'
            });
        }

        // Step 3: Return pattern result even if low confidence, or null
        if (patternResult) {
            return res.status(200).json({
                success: true,
                ...patternResult,
                warning: 'Low confidence pattern match',
                waterfall: waterfallSteps
            });
        }

        // No email found
        return res.status(200).json({
            success: false,
            email: null,
            source: null,
            message: 'Could not determine email address',
            waterfall: waterfallSteps
        });

    } catch (error) {
        console.error('Find email error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
}
