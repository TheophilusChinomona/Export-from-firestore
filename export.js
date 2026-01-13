#!/usr/bin/env node

/**
 * Firestore Export Tool
 * 
 * Exports Firestore collections (with subcollections) to JSON and SQL formats
 * 
 * Usage:
 *   npm run export                    # Export all collections (JSON + SQL)
 *   npm run export -- --collections users,projects
 *   npm run export -- --format json   # JSON only
 *   npm run export -- --format sql    # SQL only
 *   npm run export -- --resume        # Resume from last run
 */

import { program } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { initializeFirebase } from './lib/firebase.js';
import { streamCollections, getRootCollections } from './lib/collector.js';

// State file for resume functionality
const STATE_FILE = '.export-state.json';

// CLI setup
program
    .name('firestore-export')
    .description('Export Firestore collections with subcollections to JSON and SQL')
    .version('1.0.0')
    .option('-c, --collections <names>', 'Comma-separated list of collections to export (default: all)', '')
    .option('-f, --format <format>', 'Output format: json, sql, or both (default: both)', 'both')
    .option('-k, --key <path>', 'Path to service account key JSON file', config.serviceAccountPath)
    .option('-o, --output <path>', 'Output directory', config.outputDir)
    .option('-r, --resume', 'Resume from last interrupted export')
    .option('--reset', 'Clear saved state and start fresh')
    .option('-q, --quiet', 'Suppress output except errors')
    .option('-v, --verbose', 'Show detailed progress')
    .parse();

const options = program.opts();

// Apply CLI options to config
if (options.quiet) config.logLevel = 'quiet';
if (options.verbose) config.logLevel = 'verbose';
if (options.output) {
    config.outputDir = options.output;
    config.jsonOutputDir = `${options.output}/json`;
    config.sqlOutputDir = `${options.output}/sql`;
}

/**
 * Load saved export state
 */
function loadState() {
    try {
        if (existsSync(STATE_FILE)) {
            return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (error) {
        console.warn('⚠️  Could not read state file, starting fresh');
    }
    return null;
}

/**
 * Save export state
 */
function saveState(state) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Clear saved state
 */
function clearState() {
    if (existsSync(STATE_FILE)) {
        unlinkSync(STATE_FILE);
        console.log('✓ Cleared saved export state\n');
    }
}

/**
 * Format elapsed time nicely
 */
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

/**
 * Main export function
 */
async function main() {
    const startTime = Date.now();

    console.log('\n🔥 Firestore Export Tool\n');
    console.log('========================\n');

    // Handle --reset flag
    if (options.reset) {
        clearState();
    }

    try {
        // Initialize Firebase
        initializeFirebase(options.key);

        // Parse collections
        const requestedCollections = options.collections
            ? options.collections.split(',').map(c => c.trim()).filter(Boolean)
            : config.collections;

        // Get list of collections to export
        let collectionsToExport = requestedCollections;
        if (collectionsToExport.length === 0) {
            collectionsToExport = await getRootCollections();
        }

        // Check for resume state
        let completedCollections = new Set();
        let resuming = false;

        if (options.resume) {
            const savedState = loadState();
            if (savedState) {
                // Validate state matches current export
                const sameFormat = savedState.format === options.format;
                const sameCollections = JSON.stringify(savedState.requestedCollections.sort()) ===
                    JSON.stringify(collectionsToExport.sort());

                if (sameFormat && sameCollections) {
                    completedCollections = new Set(savedState.completed || []);
                    resuming = true;
                    console.log(`📂 Resuming previous export...`);
                    console.log(`   Already completed: ${completedCollections.size} collections\n`);
                } else {
                    console.log('⚠️  Previous state doesn\'t match current options, starting fresh\n');
                }
            } else {
                console.log('ℹ️  No previous state found, starting fresh\n');
            }
        }

        // Filter out already completed collections
        const remainingCollections = collectionsToExport.filter(c => !completedCollections.has(c));

        if (remainingCollections.length === 0 && resuming) {
            console.log('✅ All collections already exported!\n');
            console.log('   Use --reset to start a fresh export.\n');
            clearState();
            return;
        }

        console.log(`📋 Collections to export: ${remainingCollections.length}` +
            (resuming ? ` (${completedCollections.size} already done)` : ''));
        console.log(`   ${remainingCollections.join(', ')}\n`);
        console.log('─'.repeat(60) + '\n');

        // Initialize state
        const currentState = {
            format: options.format,
            requestedCollections: collectionsToExport,
            completed: Array.from(completedCollections),
            startedAt: resuming ? loadState()?.startedAt : new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
        };

        // Stats tracking
        let totalCollections = completedCollections.size;
        let totalDocuments = 0;
        let totalJsonFiles = 0;
        let totalSqlFiles = 0;
        const collectionTimes = [];

        // Process each collection one at a time, saving immediately
        for (let i = 0; i < remainingCollections.length; i++) {
            const collectionName = remainingCollections[i];
            const collectionStart = Date.now();

            // Progress header (adjust numbering for resume)
            const currentNum = completedCollections.size + i + 1;
            const totalNum = collectionsToExport.length;
            const progress = `[${currentNum}/${totalNum}]`;
            console.log(`\n${progress} 📁 ${collectionName}`);
            console.log('─'.repeat(40));

            try {
                // Stream and export this collection (including subcollections)
                const result = await streamCollections(
                    collectionName,
                    options.format,
                    (status) => {
                        // Progress callback - update in place
                        process.stdout.write(`\r   ${status}`.padEnd(60));
                    }
                );

                // Clear the line and show final stats
                process.stdout.write('\r' + ' '.repeat(70) + '\r');

                const elapsed = Date.now() - collectionStart;
                collectionTimes.push({ name: collectionName, time: elapsed, docs: result.totalDocs });

                console.log(`   ✓ ${result.totalDocs.toLocaleString()} documents collected`);

                if (result.subcollections > 0) {
                    console.log(`   ✓ ${result.subcollections} subcollection types found`);
                }

                if (result.jsonFiles > 0) {
                    console.log(`   ✓ ${result.jsonFiles} JSON file(s) saved`);
                    totalJsonFiles += result.jsonFiles;
                }

                if (result.sqlFiles > 0) {
                    console.log(`   ✓ ${result.sqlFiles} SQL file(s) saved`);
                    totalSqlFiles += result.sqlFiles;
                }

                console.log(`   ⏱️  ${formatTime(elapsed)}`);

                totalCollections++;
                totalDocuments += result.totalDocs;

                // Mark as completed and save state immediately
                currentState.completed.push(collectionName);
                currentState.lastUpdated = new Date().toISOString();
                saveState(currentState);

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                // Save state even on error so we can resume
                currentState.lastUpdated = new Date().toISOString();
                currentState.lastError = { collection: collectionName, error: error.message };
                saveState(currentState);

                if (!config.continueOnError) {
                    console.log('\n💡 Run with --resume to continue from this point.\n');
                    throw error;
                }
            }
        }

        // Final summary
        const totalElapsed = Date.now() - startTime;

        console.log('\n' + '═'.repeat(60));
        console.log('\n✅ EXPORT COMPLETE\n');
        console.log(`   📁 Collections exported: ${totalCollections}`);
        console.log(`   📄 Total documents: ${totalDocuments.toLocaleString()}`);
        console.log(`   📝 JSON files: ${totalJsonFiles}`);
        console.log(`   🗄️  SQL files: ${totalSqlFiles}`);
        console.log(`   ⏱️  Total time: ${formatTime(totalElapsed)}`);
        console.log(`   📂 Output: ${config.outputDir}`);

        // Show slowest collections if verbose
        if (config.logLevel === 'verbose' && collectionTimes.length > 1) {
            console.log('\n   Slowest collections:');
            collectionTimes
                .sort((a, b) => b.time - a.time)
                .slice(0, 5)
                .forEach((c, i) => {
                    console.log(`   ${i + 1}. ${c.name}: ${formatTime(c.time)} (${c.docs.toLocaleString()} docs)`);
                });
        }

        // Clear state on successful completion
        clearState();

        console.log('\n');

    } catch (error) {
        console.error('\n❌ Export failed:', error.message);
        console.log('💡 Run with --resume to continue from where you left off.\n');
        if (config.logLevel === 'verbose') {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
