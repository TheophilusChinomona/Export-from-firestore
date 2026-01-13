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
 */

import { program } from 'commander';
import { config } from './config.js';
import { initializeFirebase } from './lib/firebase.js';
import { streamCollections, getRootCollections } from './lib/collector.js';
import { exportToJson } from './lib/jsonExporter.js';
import { exportToSql } from './lib/sqlExporter.js';

// CLI setup
program
    .name('firestore-export')
    .description('Export Firestore collections with subcollections to JSON and SQL')
    .version('1.0.0')
    .option('-c, --collections <names>', 'Comma-separated list of collections to export (default: all)', '')
    .option('-f, --format <format>', 'Output format: json, sql, or both (default: both)', 'both')
    .option('-k, --key <path>', 'Path to service account key JSON file', config.serviceAccountPath)
    .option('-o, --output <path>', 'Output directory', config.outputDir)
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
 * Create a progress bar string
 */
function progressBar(current, total, width = 30) {
    const percent = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}] ${percent}%`;
}

/**
 * Main export function
 */
async function main() {
    const startTime = Date.now();

    console.log('\n🔥 Firestore Export Tool\n');
    console.log('========================\n');

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

        console.log(`\n📋 Collections to export: ${collectionsToExport.length}`);
        console.log(`   ${collectionsToExport.join(', ')}\n`);
        console.log('─'.repeat(60) + '\n');

        // Stats tracking
        let totalCollections = 0;
        let totalDocuments = 0;
        let totalJsonFiles = 0;
        let totalSqlFiles = 0;
        const collectionTimes = [];

        // Process each collection one at a time, saving immediately
        for (let i = 0; i < collectionsToExport.length; i++) {
            const collectionName = collectionsToExport[i];
            const collectionStart = Date.now();

            // Progress header
            const progress = `[${i + 1}/${collectionsToExport.length}]`;
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

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                if (!config.continueOnError) {
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

        console.log('\n');

    } catch (error) {
        console.error('\n❌ Export failed:', error.message);
        if (config.logLevel === 'verbose') {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
