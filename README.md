# Firestore Export Tool

A Node.js command-line tool for exporting Firebase Firestore collections (including nested subcollections) to JSON and MS SQL Server compatible formats.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Service Account Setup](#service-account-setup)
- [Quick Start](#quick-start)
- [Command Line Options](#command-line-options)
- [Configuration](#configuration)
- [Output Structure](#output-structure)
- [Type Mappings](#type-mappings)
- [Subcollection Handling](#subcollection-handling)
- [Importing to SQL Server](#importing-to-sql-server)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## Prerequisites

- **Node.js** v18.0.0 or higher
- **npm** (comes with Node.js)
- A **Firebase project** with Firestore database
- **Service account key** with Firestore read permissions

To check your Node.js version:
```bash
node --version
```

---

## Installation

### Quick Install (One Command)

```bash
curl -sL https://raw.githubusercontent.com/TheophilusChinomona/Export-from-firestore/main/install.sh | bash
```

This will clone the repo, install dependencies, and show you the next steps.

### Manual Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/TheophilusChinomona/Export-from-firestore.git
   cd Export-from-firestore
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

   This installs:
   - `firebase-admin` - Firebase Admin SDK for server-side access
   - `commander` - CLI argument parsing

---

## Service Account Setup

You need a Firebase service account key (JSON file) to authenticate with Firestore.

### Step 1: Go to Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Click the **gear icon** (⚙️) next to "Project Overview"
4. Select **Project settings**

### Step 2: Generate a Private Key

1. Go to the **Service accounts** tab
2. Under "Firebase Admin SDK", click **Generate new private key**
3. Click **Generate key** in the confirmation dialog
4. Save the downloaded JSON file

### Step 3: Add the Key to This Project

1. Rename the downloaded file to `serviceAccountKey.json`
2. Move it to this project's root directory:
   ```
   Export from Firebase/
   ├── serviceAccountKey.json   ← Place here
   ├── package.json
   ├── export.js
   └── ...
   ```

> ⚠️ **Security Warning**: Never commit `serviceAccountKey.json` to version control. It's already in `.gitignore` if you initialize a git repository.

---

## Quick Start

### Export All Collections (JSON + SQL)

```bash
npm run export
```

### Export Specific Collections Only

```bash
npm run export -- --collections users,projects,tickets
```

### Export JSON Only

```bash
npm run export -- --format json
```

### Export SQL Only

```bash
npm run export -- --format sql
```

---

## JSON to SQL Converter

If you've already exported JSON files and want to convert them to SQL without re-reading from Firestore:

```bash
# Convert all JSON files in output/json to SQL in output/sql
npm run convert

# Custom input/output directories
npm run convert -- --input ./my-json --output ./my-sql

# Skip CREATE TABLE statements (INSERT only)
npm run convert -- --no-create-table

# Skip DROP TABLE IF EXISTS statements
npm run convert -- --no-drop-table
```

This is useful when:
- You want to regenerate SQL with different settings
- Your Firestore export took a long time and you don't want to re-run it
- You need to convert JSON archives from previous exports

---

## Resume Interrupted Exports

If an export is cancelled or fails, you can resume from where you left off:

```bash
# Resume the previous export
npm run export -- --resume

# Resume with same options
npm run export -- --format json --resume

# Clear saved state and start fresh
npm run export -- --reset
```

The tool saves progress after each collection to `.export-state.json`. When you use `--resume`:
- Already exported collections are skipped
- Progress continues from the first incomplete collection
- Statistics show both completed and remaining collections

> **Note**: The state file tracks the format and collections you specified. If you change options (e.g., switch from `--format json` to `--format sql`), the state will be cleared and a fresh export will start.

---

## Command Line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--collections <names>` | `-c` | Comma-separated list of collections | All collections |
| `--format <format>` | `-f` | Output format: `json`, `sql`, or `both` | `both` |
| `--key <path>` | `-k` | Path to service account JSON file | `./serviceAccountKey.json` |
| `--output <path>` | `-o` | Output directory | `./output` |
| `--quiet` | `-q` | Suppress output except errors | Off |
| `--verbose` | `-v` | Show detailed progress | Off |
| `--help` | `-h` | Show help message | - |
| `--version` | `-V` | Show version number | - |

### Examples

```bash
# Export users and projects collections only
npm run export -- -c users,projects

# Use a different service account key
npm run export -- -k ./keys/production-key.json

# Export to a specific directory
npm run export -- -o ./backup/2024-01-15

# Verbose output for debugging
npm run export -- -v

# Combine multiple options
npm run export -- -c users,projects -f sql -o ./migration-data -v
```

---

## Configuration

Edit `config.js` to change default settings:

```javascript
export const config = {
  // Path to Firebase service account key
  serviceAccountPath: './serviceAccountKey.json',

  // Collections to export (empty = all collections)
  // Example: ['users', 'projects', 'tickets']
  collections: [],

  // Output directories
  outputDir: './output',
  jsonOutputDir: './output/json',
  sqlOutputDir: './output/sql',

  // SQL Server settings
  sql: {
    schema: 'dbo',              // Schema prefix for tables
    includeCreateTable: true,   // Include CREATE TABLE statements
    includeDropTable: true,     // Include DROP TABLE IF EXISTS
    maxNvarcharLength: 4000,    // Max before using NVARCHAR(MAX)
  },

  // Performance settings
  batchSize: 500,               // Documents per batch
  continueOnError: true,        // Continue if a collection fails

  // Logging: 'quiet', 'normal', 'verbose'
  logLevel: 'normal',
};
```

---

## Output Structure

After running the export, you'll find:

```
Export from Firebase/
├── output/
│   ├── json/
│   │   ├── users.json
│   │   ├── projects.json
│   │   ├── tickets.json
│   │   └── users__orders.json      ← Subcollection
│   └── sql/
│       ├── users.sql
│       ├── projects.sql
│       ├── tickets.sql
│       └── users__orders.sql       ← Subcollection
```

### JSON Output Format

Each JSON file contains:

```json
{
  "collection": "users",
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "count": 150,
  "documents": [
    {
      "_id": "abc123",
      "_path": "users/abc123",
      "id": "abc123",
      "email": "user@example.com",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "profile": "{\"firstName\":\"John\",\"lastName\":\"Doe\"}"
    }
  ]
}
```

### SQL Output Format

Each SQL file contains:

```sql
-- Firestore Export: users
-- Exported at: 2024-01-15T10:30:00.000Z
-- Document count: 150

IF OBJECT_ID('[dbo].users', 'U') IS NOT NULL
    DROP TABLE [dbo].[users];
GO

CREATE TABLE [dbo].[users] (
    id NVARCHAR(255),
    email NVARCHAR(255),
    createdAt DATETIME2,
    profile NVARCHAR(MAX),
    _path NVARCHAR(500)
);
GO

-- Data
INSERT INTO [dbo].[users] (id, email, createdAt, profile, _path) VALUES (N'abc123', N'user@example.com', N'2024-01-01T00:00:00.000Z', N'{"firstName":"John","lastName":"Doe"}', N'users/abc123');
GO
```

---

## Type Mappings

The tool automatically converts Firestore data types to SQL Server compatible formats:

| Firestore Type | SQL Server Type | Notes |
|----------------|-----------------|-------|
| `Timestamp` | `DATETIME2` | Converted to ISO 8601 string |
| `GeoPoint` | `NVARCHAR(100)` | Stored as `{"latitude":x,"longitude":y}` |
| `DocumentReference` | `NVARCHAR(500)` | Stored as document path string |
| `Array` | `NVARCHAR(MAX)` | JSON stringified |
| `Object` / `Map` | `NVARCHAR(MAX)` | JSON stringified |
| `Boolean` | `BIT` | `true` → `1`, `false` → `0` |
| `Number` (integer) | `INT` or `BIGINT` | Based on value range |
| `Number` (decimal) | `FLOAT` | - |
| `String` (≤50 chars) | `NVARCHAR(50)` | - |
| `String` (≤255 chars) | `NVARCHAR(255)` | - |
| `String` (≤4000 chars) | `NVARCHAR(4000)` | - |
| `String` (>4000 chars) | `NVARCHAR(MAX)` | - |
| `null` | `NULL` | - |

---

## Subcollection Handling

The tool automatically discovers and exports all nested subcollections.

### How It Works

1. The tool reads all documents in a collection
2. For each document, it checks for subcollections
3. Subcollections are recursively exported
4. Documents from the same subcollection type are grouped together

### Naming Convention

Subcollections are named using double underscores (`__`) to represent the hierarchy:

| Firestore Path | Output Filename |
|----------------|-----------------|
| `users` | `users.json` |
| `users/abc123/orders` | `users__orders.json` |
| `users/abc123/orders/xyz/items` | `users__orders__items.json` |

### Document Path Tracking

Each document includes a `_path` field with its full Firestore path:

```json
{
  "_id": "order-001",
  "_path": "users/abc123/orders/order-001",
  "total": 99.99
}
```

This allows you to:
- Reconstruct the parent-child relationships
- Identify which parent document a subcollection item belongs to

---

## Importing to SQL Server

### Using SQL Server Management Studio (SSMS)

1. Open SSMS and connect to your database
2. Open a new query window
3. Open your `.sql` file (File → Open → File)
4. Execute the script (F5 or click Execute)

### Using sqlcmd

```bash
sqlcmd -S your-server.database.windows.net -d YourDatabase -U username -P password -i output/sql/users.sql
```

### Importing All SQL Files

PowerShell script to import all files:

```powershell
$server = "your-server.database.windows.net"
$database = "YourDatabase"
$username = "your-username"
$password = "your-password"

Get-ChildItem -Path "output/sql/*.sql" | ForEach-Object {
    Write-Host "Importing $($_.Name)..."
    sqlcmd -S $server -d $database -U $username -P $password -i $_.FullName
}

Write-Host "Import complete!"
```

### Post-Import Considerations

After importing, you may want to:

1. **Add primary keys**:
   ```sql
   ALTER TABLE users ADD CONSTRAINT PK_users PRIMARY KEY (id);
   ```

2. **Add foreign keys** (for subcollection relationships):
   ```sql
   ALTER TABLE users__orders
   ADD CONSTRAINT FK_orders_users
   FOREIGN KEY (userId) REFERENCES users(id);
   ```

3. **Create indexes** for frequently queried columns:
   ```sql
   CREATE INDEX IX_users_email ON users(email);
   ```

4. **Parse JSON columns** if needed:
   ```sql
   SELECT
     id,
     JSON_VALUE(profile, '$.firstName') AS firstName,
     JSON_VALUE(profile, '$.lastName') AS lastName
   FROM users;
   ```

---

## Troubleshooting

### "Service account file not found"

```
Error: Service account file not found: ./serviceAccountKey.json
```

**Solution**: Make sure you've downloaded and placed your Firebase service account key in the project directory. See [Service Account Setup](#service-account-setup).

### "Permission denied" errors

```
Error: Missing or insufficient permissions
```

**Solution**: Your service account needs the `Cloud Datastore User` role or higher. In Firebase Console:
1. Go to Project Settings → Service Accounts
2. Click "Manage service account permissions"
3. Add the `Cloud Datastore User` role

### Empty export / No collections found

```
⚠️ No collections found to export.
```

**Possible causes**:
- The Firestore database is empty
- The service account is for a different project
- Collections exist only in a different region

**Solution**: Verify you're using the correct project's service account and that data exists in Firestore.

### Memory issues with large collections

If you run out of memory exporting large collections:

1. Reduce batch size in `config.js`:
   ```javascript
   batchSize: 100,  // Lower value uses less memory
   ```

2. Export collections one at a time:
   ```bash
   npm run export -- -c large-collection-1
   npm run export -- -c large-collection-2
   ```

### SQL insertion errors

If you get errors when running SQL files:

- **String truncation**: The tool infers column sizes from data. If new data is larger, alter the column:
  ```sql
  ALTER TABLE users ALTER COLUMN bio NVARCHAR(MAX);
  ```

- **Reserved word conflicts**: Column names that are SQL reserved words are automatically quoted with `[]`, but if you see issues, check the column names.

---

## Project Structure

```
Export from Firebase/
├── package.json          # Dependencies and npm scripts
├── config.js             # Configuration options
├── export.js             # Main CLI entry point
├── lib/
│   ├── firebase.js       # Firebase Admin SDK initialization
│   ├── collector.js      # Recursive collection discovery
│   ├── transformers.js   # Firestore → SQL type conversions
│   ├── jsonExporter.js   # JSON file writer
│   └── sqlExporter.js    # SQL file generator
├── output/               # Generated after export (auto-created)
│   ├── json/
│   └── sql/
└── README.md             # This file
```

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `firebase.js` | Initializes Admin SDK with service account |
| `collector.js` | Discovers all collections/subcollections, reads documents in batches |
| `transformers.js` | Converts Firestore types (Timestamp, GeoPoint, etc.) to SQL-compatible formats |
| `jsonExporter.js` | Writes documents to JSON files with metadata |
| `sqlExporter.js` | Generates CREATE TABLE and INSERT statements |

---

## License

MIT License - feel free to use and modify as needed.

---

## Support

If you encounter issues:

1. Run with verbose logging: `npm run export -- -v`
2. Check the [Troubleshooting](#troubleshooting) section
3. Verify your service account permissions in Firebase Console
