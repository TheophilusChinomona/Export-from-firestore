/**
 * Firestore Collection Collector
 * 
 * Recursively discovers and collects all documents from collections and subcollections
 * Now with streaming export - saves files immediately as each collection is processed
 */

import { getFirestore } from './firebase.js';
import { config } from '../config.js';
import { exportToJson } from './jsonExporter.js';
import { exportToSql } from './sqlExporter.js';

/**
 * Get all root-level collection references
 * @returns {Promise<string[]>} Array of collection names
 */
export async function getRootCollections() {
    const db = getFirestore();
    const collections = await db.listCollections();
    return collections.map(col => col.id);
}

/**
 * Get all subcollections for a document
 * @param {FirebaseFirestore.DocumentReference} docRef 
 * @returns {Promise<string[]>} Array of subcollection names
 */
export async function getSubcollections(docRef) {
    const collections = await docRef.listCollections();
    return collections.map(col => col.id);
}

/**
 * Collect all documents from a collection (with pagination and progress)
 * @param {FirebaseFirestore.CollectionReference} collectionRef 
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Array<{id: string, data: object, path: string, ref: any}>>}
 */
async function collectDocuments(collectionRef, onProgress) {
    const documents = [];
    let lastDoc = null;
    let batchNumber = 0;

    while (true) {
        let query = collectionRef.limit(config.batchSize);

        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            break;
        }

        for (const doc of snapshot.docs) {
            documents.push({
                id: doc.id,
                data: doc.data(),
                path: doc.ref.path,
                ref: doc.ref,
            });
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        batchNumber++;

        // Report progress
        if (onProgress) {
            onProgress(`Reading... ${documents.length.toLocaleString()} documents (batch ${batchNumber})`);
        }

        // If we got fewer documents than the batch size, we're done
        if (snapshot.docs.length < config.batchSize) {
            break;
        }
    }

    return documents;
}

/**
 * Normalize collection path for use as filename
 * Groups all subcollections of the same type together
 * e.g., "users/abc/orders" and "users/xyz/orders" both become "users__orders"
 * @param {string} path 
 * @returns {string}
 */
function normalizeCollectionPath(path) {
    const parts = path.split('/');
    // Keep only collection names (odd indices are document IDs)
    const collectionParts = parts.filter((_, index) => index % 2 === 0);
    return collectionParts.join('__');
}

/**
 * Stream a collection and its subcollections, exporting immediately
 * @param {string} collectionName - Root collection name
 * @param {string} format - 'json', 'sql', or 'both'
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{totalDocs: number, subcollections: number, jsonFiles: number, sqlFiles: number}>}
 */
export async function streamCollections(collectionName, format = 'both', onProgress = () => { }) {
    const db = getFirestore();
    const results = {
        totalDocs: 0,
        subcollections: 0,
        jsonFiles: 0,
        sqlFiles: 0,
    };

    // Map to accumulate documents by normalized path
    const documentsByPath = new Map();

    // Queue for processing - start with root collection
    const queue = [{ path: collectionName, depth: 0 }];
    const processedPaths = new Set();

    while (queue.length > 0) {
        const { path, depth } = queue.shift();

        if (processedPaths.has(path)) continue;
        processedPaths.add(path);

        const collectionRef = db.collection(path);
        onProgress(`Collecting: ${path}`);

        // Collect documents in this collection
        const documents = await collectDocuments(collectionRef, onProgress);

        if (documents.length > 0) {
            results.totalDocs += documents.length;

            // Group by normalized path
            const normalizedPath = normalizeCollectionPath(path);
            if (!documentsByPath.has(normalizedPath)) {
                documentsByPath.set(normalizedPath, []);
                if (depth > 0) {
                    results.subcollections++;
                }
            }

            // Add documents (without ref for storage)
            documentsByPath.get(normalizedPath).push(
                ...documents.map(({ id, data, path }) => ({ id, data, path }))
            );

            // Check for subcollections on each document
            for (let i = 0; i < documents.length; i++) {
                const doc = documents[i];
                onProgress(`Checking subcollections... ${i + 1}/${documents.length}`);

                const subcollections = await getSubcollections(doc.ref);

                for (const subcollectionName of subcollections) {
                    const subcollectionPath = `${doc.path}/${subcollectionName}`;
                    if (!processedPaths.has(subcollectionPath)) {
                        queue.push({ path: subcollectionPath, depth: depth + 1 });
                    }
                }
            }
        }
    }

    // Export all accumulated documents immediately
    for (const [normalizedPath, documents] of documentsByPath) {
        if (documents.length === 0) continue;

        onProgress(`Saving: ${normalizedPath} (${documents.length.toLocaleString()} docs)`);

        try {
            if (format === 'json' || format === 'both') {
                exportToJson(normalizedPath, documents, () => { });
                results.jsonFiles++;
            }

            if (format === 'sql' || format === 'both') {
                exportToSql(normalizedPath, documents, () => { });
                results.sqlFiles++;
            }
        } catch (error) {
            console.error(`\n   Error saving ${normalizedPath}: ${error.message}`);
            if (!config.continueOnError) {
                throw error;
            }
        }
    }

    return results;
}

/**
 * Collect all data from specified collections (or all if none specified)
 * @deprecated Use streamCollections for better progress and immediate saving
 * @param {string[]} collections - Array of collection names to export (empty = all)
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Map<string, Array>>} Map of collection paths to document arrays
 */
export async function collectAllData(collections = [], onProgress = console.log) {
    const allResults = new Map();

    let collectionsToProcess = collections;

    if (collectionsToProcess.length === 0) {
        collectionsToProcess = await getRootCollections();
        onProgress(`\n🔍 Found ${collectionsToProcess.length} root collections: ${collectionsToProcess.join(', ')}\n`);
    }

    for (const collectionName of collectionsToProcess) {
        try {
            const db = getFirestore();
            const collectionRef = db.collection(collectionName);

            onProgress(`📁 Collecting: ${collectionName}`);
            const documents = await collectDocuments(collectionRef, onProgress);

            if (documents.length > 0) {
                allResults.set(collectionName, documents.map(({ id, data, path }) => ({ id, data, path })));
                onProgress(`   ✓ ${documents.length} documents`);
            }
        } catch (error) {
            onProgress(`❌ Error collecting ${collectionName}: ${error.message}`);
            if (!config.continueOnError) {
                throw error;
            }
        }
    }

    return allResults;
}
