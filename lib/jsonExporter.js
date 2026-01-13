/**
 * JSON Exporter
 * 
 * Exports Firestore collections to JSON files
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { transformDocument, sanitizeFileName } from './transformers.js';

/**
 * Export a collection to a JSON file
 * @param {string} collectionName - Normalized collection name
 * @param {Array<{id: string, data: object, path: string}>} documents 
 * @param {function} onProgress - Progress callback
 * @returns {string} Path to the created file
 */
export function exportToJson(collectionName, documents, onProgress = console.log) {
    // Ensure output directory exists
    if (!existsSync(config.jsonOutputDir)) {
        mkdirSync(config.jsonOutputDir, { recursive: true });
    }

    // Sanitize collection name for filename
    const safeCollectionName = sanitizeFileName(collectionName);

    // Transform all documents
    const transformedDocuments = documents.map(doc => {
        const { data } = transformDocument(doc.id, doc.data);
        return {
            _id: doc.id,
            _path: doc.path,
            ...data,
        };
    });

    // Create output
    const output = {
        collection: collectionName,  // Keep original name in metadata
        exportedAt: new Date().toISOString(),
        count: transformedDocuments.length,
        documents: transformedDocuments,
    };

    // Write file
    const filename = `${safeCollectionName}.json`;
    const filepath = join(config.jsonOutputDir, filename);

    writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf8');

    if (config.logLevel !== 'quiet') {
        onProgress(`   📄 JSON: ${filename} (${transformedDocuments.length} documents)`);
    }

    return filepath;
}

/**
 * Export multiple collections to JSON files
 * @param {Map<string, Array>} collectionsData - Map of collection names to documents
 * @param {function} onProgress - Progress callback
 * @returns {string[]} Array of created file paths
 */
export function exportAllToJson(collectionsData, onProgress = console.log) {
    const files = [];

    for (const [collectionName, documents] of collectionsData) {
        if (documents.length === 0) continue;

        try {
            const filepath = exportToJson(collectionName, documents, onProgress);
            files.push(filepath);
        } catch (error) {
            onProgress(`   ❌ Error exporting ${collectionName} to JSON: ${error.message}`);
            if (!config.continueOnError) {
                throw error;
            }
        }
    }

    return files;
}
