/**
 * Firebase Admin SDK Initialization
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { config } from '../config.js';

let db = null;

/**
 * Initialize Firebase Admin SDK
 * @param {string} serviceAccountPath - Path to service account JSON file
 * @returns {FirebaseFirestore.Firestore} Firestore instance
 */
export function initializeFirebase(serviceAccountPath = config.serviceAccountPath) {
    if (db) {
        return db;
    }

    try {
        const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });

        db = admin.firestore();
        console.log(`✓ Connected to Firestore project: ${serviceAccount.project_id}`);

        return db;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Service account file not found: ${serviceAccountPath}\n` +
                'Please place your Firebase service account key JSON file in the project directory.');
        }
        throw error;
    }
}

/**
 * Get Firestore instance
 * @returns {FirebaseFirestore.Firestore}
 */
export function getFirestore() {
    if (!db) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return db;
}
