#!/usr/bin/env node

/**
 * Usage Statistics Generator
 *
 * This script fetches logs from Vercel and generates usage statistics
 * for the ColdEmailCopilot extension.
 *
 * Usage:
 *   node scripts/generate-usage-stats.js
 *   node scripts/generate-usage-stats.js --days 7
 *   node scripts/generate-usage-stats.js --output admin/usage-data.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find(arg => arg.startsWith('--days='));
const outputArg = args.find(arg => arg.startsWith('--output='));

const DAYS = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
const OUTPUT_FILE = outputArg ? outputArg.split('=')[1] : 'admin/usage-data.json';

console.log(`📊 Fetching Vercel logs for the last ${DAYS} days...`);
console.log('');

try {
  // Calculate timestamp for N days ago
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Fetch logs from Vercel
  console.log('⏳ Running: vercel logs --since=' + since);
  const logs = execSync(`vercel logs --since=${since}`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
  });

  // Parse usage logs
  const usageLogs = [];
  const lines = logs.split('\n');

  for (const line of lines) {
    try {
      // Look for our structured USAGE_LOG entries
      if (line.includes('USAGE_LOG')) {
        // Extract JSON from the log line
        const jsonMatch = line.match(/\{.*"type"\s*:\s*"USAGE_LOG".*\}/);
        if (jsonMatch) {
          const usageData = JSON.parse(jsonMatch[0]);
          usageLogs.push(usageData);
        }
      }
    } catch (e) {
      // Skip lines that can't be parsed
      continue;
    }
  }

  console.log(`✅ Found ${usageLogs.length} usage log entries`);
  console.log('');

  // Calculate statistics
  const stats = calculateStats(usageLogs);

  // Save to file
  const outputPath = path.resolve(OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    period: {
      days: DAYS,
      start: since,
      end: new Date().toISOString()
    },
    stats: stats,
    rawLogs: usageLogs
  }, null, 2));

  console.log(`💾 Saved statistics to: ${outputPath}`);
  console.log('');

  // Print summary
  printSummary(stats);

  console.log('');
  console.log(`📈 Open admin/index.html in your browser to view the dashboard`);

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('');
  console.error('Make sure you have:');
  console.error('  1. Vercel CLI installed: npm install -g vercel');
  console.error('  2. Logged in to Vercel: vercel login');
  console.error('  3. Linked this project: vercel link');
  process.exit(1);
}

/**
 * Calculate statistics from usage logs
 */
function calculateStats(logs) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Group by email
  const byEmail = {};
  const byDay = {};
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let totalTokens = 0;

  for (const log of logs) {
    totalRequests++;

    if (log.success) {
      successfulRequests++;
      totalTokens += log.tokens || 0;
    } else {
      failedRequests++;
    }

    // Group by email
    const email = log.email || 'unknown';
    if (!byEmail[email]) {
      byEmail[email] = {
        email: email,
        total: 0,
        successful: 0,
        failed: 0,
        tokens: 0,
        last24h: 0,
        last7d: 0,
        last30d: 0,
        models: {},
        failureReasons: {}
      };
    }

    const emailStats = byEmail[email];
    emailStats.total++;

    if (log.success) {
      emailStats.successful++;
      emailStats.tokens += log.tokens || 0;

      // Track model usage
      const model = log.model || 'unknown';
      emailStats.models[model] = (emailStats.models[model] || 0) + 1;
    } else {
      emailStats.failed++;
      const reason = log.reason || 'unknown';
      emailStats.failureReasons[reason] = (emailStats.failureReasons[reason] || 0) + 1;
    }

    // Time-based counts
    const logTime = new Date(log.timestamp).getTime();
    const age = now - logTime;

    if (age <= day) emailStats.last24h++;
    if (age <= 7 * day) emailStats.last7d++;
    if (age <= 30 * day) emailStats.last30d++;

    // Group by day for time series
    const date = log.timestamp.split('T')[0];
    if (!byDay[date]) {
      byDay[date] = { date, requests: 0, successful: 0, failed: 0 };
    }
    byDay[date].requests++;
    if (log.success) {
      byDay[date].successful++;
    } else {
      byDay[date].failed++;
    }
  }

  // Convert to arrays and sort
  const emailStats = Object.values(byEmail)
    .sort((a, b) => b.total - a.total);

  const timeSeriesData = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    overall: {
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate: totalRequests > 0 ? (successfulRequests / totalRequests * 100).toFixed(1) : 0,
      totalTokens,
      avgTokensPerRequest: successfulRequests > 0 ? Math.round(totalTokens / successfulRequests) : 0
    },
    byEmail: emailStats,
    timeSeries: timeSeriesData,
    topUsers: emailStats.slice(0, 10)
  };
}

/**
 * Print summary to console
 */
function printSummary(stats) {
  console.log('📈 USAGE SUMMARY');
  console.log('═'.repeat(60));
  console.log('');

  console.log('Overall Statistics:');
  console.log(`  Total Requests:      ${stats.overall.totalRequests}`);
  console.log(`  Successful:          ${stats.overall.successfulRequests} (${stats.overall.successRate}%)`);
  console.log(`  Failed:              ${stats.overall.failedRequests}`);
  console.log(`  Total Tokens:        ${stats.overall.totalTokens.toLocaleString()}`);
  console.log(`  Avg Tokens/Request:  ${stats.overall.avgTokensPerRequest}`);
  console.log('');

  console.log('Top Users:');
  console.log('─'.repeat(60));
  stats.topUsers.slice(0, 5).forEach((user, i) => {
    console.log(`${i + 1}. ${user.email}`);
    console.log(`   Total: ${user.total} | Success: ${user.successful} | Failed: ${user.failed}`);
    console.log(`   24h: ${user.last24h} | 7d: ${user.last7d} | 30d: ${user.last30d}`);
    if (user.tokens > 0) {
      console.log(`   Tokens: ${user.tokens.toLocaleString()}`);
    }
    console.log('');
  });
}
