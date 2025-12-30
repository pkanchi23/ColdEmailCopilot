# Admin Dashboard

A simple analytics dashboard to monitor ColdEmailCopilot usage and track per-user statistics.

## Quick Start

### 1. Generate Usage Stats

Run the stats generator script to fetch and parse Vercel logs:

```bash
node scripts/generate-usage-stats.js
```

This will:
- Fetch logs from Vercel for the last 7 days
- Parse usage data
- Generate `admin/usage-data.json`
- Print a summary to the console

### 2. View Dashboard

Open `admin/index.html` in your browser:

```bash
# macOS
open admin/index.html

# Linux
xdg-open admin/index.html

# Windows
start admin/index.html
```

Or simply double-click the `index.html` file.

### 3. Refresh Data

To update the dashboard with the latest data:

1. Run the script again: `node scripts/generate-usage-stats.js`
2. Refresh the dashboard in your browser

---

## Dashboard Features

### Overview Cards
- **Total Requests**: All API calls in the time period
- **Success Rate**: Percentage of successful requests
- **Total Tokens**: Sum of all tokens used (input + output)
- **Active Users**: Number of unique users

### Requests Over Time Chart
- Visual timeline of daily request volume
- Hover to see exact counts per day

### User Details
For each user, you can see:
- **Email address**
- **Total requests** (all time in the period)
- **Last 24h/7d/30d** request counts
- **Token usage** (for successful requests)
- **Models used** (which AI models they're using)
- **Failure reasons** (if any requests failed)

---

## Script Options

### Fetch More Days

```bash
# Last 30 days
node scripts/generate-usage-stats.js --days=30

# Last 1 day
node scripts/generate-usage-stats.js --days=1
```

### Custom Output Location

```bash
node scripts/generate-usage-stats.js --output=my-stats.json
```

Then update `admin/index.html` to fetch from the new location.

---

## Understanding the Data

### Success vs Failed Requests

**Successful (200):**
- User authenticated successfully
- Email is whitelisted
- Anthropic API responded successfully

**Failed requests and reasons:**
- `invalid_token` (401): Google OAuth token verification failed
- `not_whitelisted` (403): User's email is not in the whitelist
- `server_error` (500): Anthropic API or server issues

### Token Usage

Tokens represent the computational cost of each request:
- **Input tokens**: Profile data + prompt sent to the AI
- **Output tokens**: Generated email response
- **Total tokens**: Input + Output

Higher token usage = longer/more complex profiles and emails.

---

## Automating Stats Generation

### Run Every Hour

**macOS/Linux (cron):**

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour at minute 0)
0 * * * * cd /path/to/ColdEmailCopilot && node scripts/generate-usage-stats.js
```

**Windows (Task Scheduler):**

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily, repeat every 1 hour
4. Action: Start a program
5. Program: `node`
6. Arguments: `C:\path\to\ColdEmailCopilot\scripts\generate-usage-stats.js`
7. Start in: `C:\path\to\ColdEmailCopilot`

### GitHub Actions (Auto-Update)

You can set up a GitHub Action to automatically generate and commit stats:

```yaml
# .github/workflows/update-stats.yml
name: Update Usage Stats
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Manual trigger

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install Vercel CLI
        run: npm install -g vercel
      - name: Generate Stats
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        run: |
          vercel login --token $VERCEL_TOKEN
          node scripts/generate-usage-stats.js
      - name: Commit Stats
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add admin/usage-data.json
          git commit -m "Update usage stats" || true
          git push
```

---

## Troubleshooting

### "Command 'vercel' not found"

Install the Vercel CLI:

```bash
npm install -g vercel
```

### "Error: Not logged in"

Log in to Vercel:

```bash
vercel login
```

### "Error: Project not linked"

Link your project:

```bash
vercel link
```

Then select your project from the list.

### "No usage logs found"

This could mean:
1. No one has used the extension yet
2. Logs are older than the requested time period
3. The logging code hasn't been deployed yet

**Solution:** Deploy the updated function with logging:

```bash
vercel --prod
```

Then use the extension to generate an email, and run the stats script again.

### Dashboard shows old data

The dashboard loads data from `usage-data.json`. To see fresh data:

1. Run: `node scripts/generate-usage-stats.js`
2. Refresh the dashboard page

---

## Example Output

**Console:**

```
📊 Fetching Vercel logs for the last 7 days...

⏳ Running: vercel logs --since=2025-01-23T10:00:00.000Z
✅ Found 143 usage log entries

💾 Saved statistics to: /path/to/admin/usage-data.json

📈 USAGE SUMMARY
════════════════════════════════════════════════════════════

Overall Statistics:
  Total Requests:      143
  Successful:          137 (95.8%)
  Failed:              6
  Total Tokens:        1,247,832
  Avg Tokens/Request:  9,108

Top Users:
──────────────────────────────────────────────────────────
1. john@company.com
   Total: 48 | Success: 47 | Failed: 1
   24h: 12 | 7d: 48 | 30d: 48
   Tokens: 436,584

2. sarah@company.com
   Total: 35 | Success: 35 | Failed: 0
   24h: 8 | 7d: 35 | 30d: 35
   Tokens: 318,780

3. mike@company.com
   Total: 27 | Success: 26 | Failed: 1
   24h: 5 | 7d: 27 | 30d: 27
   Tokens: 236,808

...

📈 Open admin/index.html in your browser to view the dashboard
```

**Dashboard:**

Beautiful visual interface showing:
- 📊 Total requests, success rate, token usage
- 📈 Timeline chart of daily activity
- 👥 Detailed per-user breakdowns
- 🔄 Refresh button to reload

---

## Tips

1. **Run stats daily**: Set up a cron job or scheduled task
2. **Check failure reasons**: Identify users who need to be whitelisted
3. **Monitor token usage**: Identify power users or unusually large requests
4. **Track trends**: Use the time series chart to see adoption over time
5. **Export data**: The `usage-data.json` file can be imported into Excel or other tools

---

## Security Note

The dashboard runs entirely client-side. The `usage-data.json` file contains:
- User email addresses
- Request timestamps
- Success/failure counts
- Token usage

**Recommendations:**
- Don't commit `usage-data.json` to public repositories
- Add `admin/usage-data.json` to `.gitignore`
- Host the dashboard privately (not publicly accessible)

---

## Need Help?

- **Script errors**: Check that Vercel CLI is installed and you're logged in
- **No data**: Make sure the Vercel function has been deployed with logging
- **Dashboard issues**: Check browser console for errors
