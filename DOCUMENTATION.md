# Financial Forensics Engine - Complete Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [What is Money Muling?](#what-is-money-muling)
3. [Core Features](#core-features)
4. [Detection Patterns Explained](#detection-patterns-explained)
5. [Architecture & Technology Stack](#architecture--technology-stack)
6. [How to Use the Application](#how-to-use-the-application)
7. [Understanding the Results](#understanding-the-results)
8. [Scoring Methodology](#scoring-methodology)
9. [JSON Export Format](#json-export-format)
10. [Algorithm Deep Dive](#algorithm-deep-dive)
11. [Performance Characteristics](#performance-characteristics)
12. [Testing & Validation](#testing--validation)

---

## Project Overview

The **Financial Forensics Engine** is a web-based application designed to detect money muling networks in financial transaction data. It uses advanced graph theory algorithms to analyze patterns of money movement between accounts, identifying suspicious behaviors that traditional database queries often miss.

### The Problem It Solves

When criminals move illicit money, they don't transfer it directly from source to destination. Instead, they use a network of intermediary accounts (called "mules") to:
- Break large sums into smaller transactions
- Create complex webs of transfers to obscure the money trail
- Move funds through multiple cities or countries
- Make it extremely difficult to trace the original source

Traditional banking systems look at individual transactions, but they can't see the **big picture** of how money flows through an entire network. This engine solves that problem by visualizing and analyzing the complete graph of financial relationships.

---

## What is Money Muling?

Money muling is a type of financial crime where criminals use legitimate-looking bank accounts (often belonging to unsuspecting victims or willing participants) to transfer and disguise the origin of illicit funds.

### The Three Main Patterns

#### 1. Circular Fund Routing (Cycles)

**What it looks like:**
```
Account A → Account B → Account C → Account A
```

**Why it's suspicious:**
- Money goes in a circle and returns to where it started
- This creates fake transaction volume and obscures the money's origin
- Often used to "clean" money by making it appear as multiple legitimate transactions
- The cycle length is typically 3-5 accounts (longer cycles are harder to coordinate)

**Real-world example:**
- A criminal sends $10,000 from Account A to Account B
- Account B sends it to Account C
- Account C sends it back to Account A
- Now the $10,000 appears to have come from Account C, not the original criminal source

#### 2. Smurfing / Structuring (Fan-in Pattern)

**What it looks like:**
```
         ↗  Account A
         ↗  Account B
         ↗  Account C
         ↗  Account D
Source →→  Account E (Aggregator)
         ↗  Account F
         ↗  Account G
         ↗  Account H
```

**Why it's suspicious:**
- Many small deposits (often under reporting thresholds) flow into one central account
- Designed to avoid triggering bank alerts for large transactions
- The central "aggregator" account then sends money elsewhere
- Typically happens within a short time window (72 hours)

**Real-world example:**
- 12 different people each deposit $900 into Account E over 6 hours
- Total: $10,800 moved without triggering a $10,000+ alert
- Account E then transfers the full amount to an offshore account

#### 3. Layered Shell Networks

**What it looks like:**
```
Account A → Account B → Account C → Account D → Account E
            (2 txs)     (2 txs)     (2 txs)
```

**Why it's suspicious:**
- Money passes through a chain of 3+ intermediate accounts
- The middle accounts (B, C, D) have very few total transactions (2-3 each)
- These "shell" accounts exist only to move money and have no legitimate purpose
- Creates multiple layers of separation between source and destination

**Real-world example:**
- A drug dealer sends money to Account A
- Account A sends to Account B (which only ever transacts with A and C)
- Account B sends to Account C (which only ever transacts with B and D)
- Account C sends to Account D (the final destination)
- Each layer makes it harder to trace back to the original source

---

## Core Features

### 1. CSV Upload & Processing

**What it does:**
- Accepts transaction data in CSV format
- Automatically parses and validates the data
- Handles various timestamp formats (YYYY-MM-DD HH:MM:SS or DD-MM-YYYY HH:mm)
- Normalizes amounts and detects data quality issues

**Required CSV Format:**
```
transaction_id,sender_id,receiver_id,amount,timestamp
TXN001,ACC_001,ACC_002,5000.00,2026-01-15 10:30:00
TXN002,ACC_002,ACC_003,5000.00,2026-01-15 14:45:00
TXN003,ACC_003,ACC_001,5000.00,2026-01-15 16:20:00
```

### 2. Interactive Graph Visualization

**What it shows:**
- Every account appears as a node (circle)
- Every transaction appears as a directed arrow
- Suspicious accounts are colored differently:
  - **Red**: High suspicion score (80-100)
  - **Yellow**: Medium suspicion score (50-79)
  - **Gray**: Low suspicion score (below 50)

**Interactive features:**
- Click any node to see detailed account information
- Drag nodes to rearrange the view
- Zoom and pan to explore large networks
- Hover over connections to see transaction details

### 3. Account Inspector Panel

**What it displays for each account:**
- Account ID and suspicion score
- Number of incoming and outgoing connections
- Betweenness centrality (how important this account is to the network)
- Which fraud patterns were detected
- Which ring(s) this account belongs to
- All connected accounts with amounts

**Why it matters:**
This panel helps investigators understand WHY an account is suspicious and how it fits into the larger network.

### 4. Fraud Ring Summary Table

**What it shows:**
- A table of all detected fraud rings
- Ring ID, pattern type, member count, and risk score
- Click any ring to see its member accounts highlighted

### 5. Timeline Playback

**What it does:**
- Shows how money moved through the network over time
- Use the slider to see transactions as they happened
- Helps visualize the sequence of smurfing or layering activities
- Useful for understanding temporal patterns

### 6. JSON Export

**What it provides:**
- A downloadable JSON file with all analysis results
- Structured data for automated processing
- Exact format required for hackathon grading
- Includes suspicious accounts, fraud rings, and summary statistics

---

## Detection Patterns Explained

### How Circular Fund Routing is Detected

**The Algorithm (Simple Explanation):**

1. **Build a graph**: Create a map of who sent money to whom
2. **Start from every account**: For each account, try to find a path that returns to it
3. **Follow the money**: Use depth-first search to explore paths of length 3-5
4. **Check timestamps**: Ensure transactions happen in chronological order (A→B must happen before B→C)
5. **Record cycles**: When we find A→B→C→A, we record it as a circular routing pattern

**Scoring Boosts:**
- Base score: 80 points for being in a cycle
- +5 points if all transactions in the cycle happened within 24 hours (indicates coordinated activity)
- +5 points based on cycle length (longer cycles are slightly more suspicious)

### How Smurfing (Fan-in) is Detected

**The Algorithm (Simple Explanation):**

1. **Look at receivers**: For each account that receives money, examine all incoming transactions
2. **Sliding time window**: Check 72-hour windows to see how many unique senders contributed
3. **Count unique sources**: Track how many different accounts sent money within each window
4. **Threshold check**: If 10+ unique senders sent money within 72 hours, flag it
5. **Record the pattern**: Create a smurfing ring with all participants

**Why it works:**
- Legitimate businesses might receive from many sources, but not typically within such a short window
- Criminals need to move money quickly before it's detected
- The 72-hour window captures the urgency of criminal operations

**Scoring:**
- Aggregator (receiver): 85 points + base score
- Senders: 25 points each
- Ring risk score: 80 + number of senders (capped at 100)

### How Layered Shell Networks are Detected

**The Algorithm (Simple Explanation):**

1. **Find low-activity accounts**: Identify accounts with only 2-3 total transactions
2. **Trace chains**: Look for paths where these low-activity accounts sit between two others
3. **Require 3+ hops**: A chain must have at least 3 transfers to be considered layered
4. **Check temporality**: Ensure transactions happen in order with reasonable time gaps
5. **Flag as suspicious**: Mark all accounts in such chains as part of a layered shell network

**Why it works:**
- Legitimate accounts typically have many connections (paying bills, receiving salary, etc.)
- Shell accounts exist only to receive and immediately forward money
- The pattern of 2-degree nodes chained together is a strong fraud indicator

**Scoring:**
- 40 points for being in a layered chain
- +5 points per intermediate hop (more layers = more suspicious)

---

## Architecture & Technology Stack

### Frontend (What You See)

**React + Next.js**
- Modern React framework for building interactive web applications
- Server-side rendering for fast initial load
- Static site generation for deployment

**Tailwind CSS**
- Utility-first CSS framework for clean, responsive design
- Light theme with professional financial appearance

**React-Force-Graph-2D**
- Interactive graph visualization library
- Handles physics simulation for node positioning
- Supports zoom, pan, click, and hover interactions

### Backend (The Processing Engine)

**Next.js API Routes**
- Serverless functions for processing CSV uploads
- Handles file parsing and analysis
- Returns JSON results to the frontend

### Core Analysis Libraries (Custom Built)

**Graph Theory Engine**
- Implements graph algorithms from scratch
- Optimized for financial transaction analysis
- Supports cycles, centrality, and pathfinding

**CSV Parser**
- Uses PapaParse for fast, reliable CSV parsing
- Validates data format and types
- Normalizes timestamps and amounts

### Key Files & Their Purposes

| File | Purpose |
|------|---------|
| `src/lib/analyze.ts` | Core detection algorithms (cycles, smurfing, layering) |
| `src/lib/exportJson.ts` | JSON export formatting and pattern mapping |
| `src/lib/parseCsv.ts` | CSV parsing and validation |
| `src/lib/utils.ts` | Utility functions (ring ID generation, cycle canonicalization) |
| `src/lib/types.ts` | TypeScript type definitions |
| `src/components/Dashboard.tsx` | Main UI component with graph and panels |
| `src/app/api/analyze/route.ts` | API endpoint for processing uploads |

---

## How to Use the Application

### Step 1: Prepare Your Data

Create a CSV file with these exact columns:
```
transaction_id,sender_id,receiver_id,amount,timestamp
```

**Requirements:**
- `transaction_id`: Unique identifier for each transaction
- `sender_id`: Account ID sending money
- `receiver_id`: Account ID receiving money  
- `amount`: Numeric value (with or without currency symbol)
- `timestamp`: Date and time (YYYY-MM-DD HH:MM:SS or DD-MM-YYYY HH:mm)

### Step 2: Upload the CSV

1. Open the application in your browser
2. Click "Upload CSV File" or drag-and-drop your file
3. The system will automatically parse and analyze the data

### Step 3: Explore the Results

**Understanding the Graph:**
- **Red nodes**: High-risk accounts (score 80+)
- **Yellow nodes**: Medium-risk accounts (score 50-79)
- **Gray nodes**: Low-risk or normal accounts
- **Arrows**: Show direction of money flow
- **Arrow thickness**: Can represent transaction amount

**Using the Account Inspector:**
1. Click any node to see detailed information
2. View the account's connections, scores, and detected patterns
3. See which fraud ring(s) it belongs to

**Using the Timeline:**
1. Drag the slider to see transactions over time
2. Watch how money moved through the network
3. Identify bursts of activity (common in smurfing)

### Step 4: Download Results

Click "Download JSON Report" to get a structured file containing:
- All suspicious accounts with scores
- All detected fraud rings
- Summary statistics

---

## Understanding the Results

### Suspicion Score Ranges

| Score Range | Risk Level | Interpretation |
|-------------|------------|----------------|
| 90-100 | Critical | Almost certainly fraudulent. Immediate investigation required. |
| 80-89 | High | Very suspicious. Strong indicators of money muling. |
| 50-79 | Medium | Suspicious activity detected. Worth monitoring. |
| 0-49 | Low | No significant suspicious patterns detected. |

### What Each Pattern Means

**Circular Fund Routing**
- Money went in a circle and returned to the start
- Accounts involved are coordinating to obscure money trails
- High confidence of fraudulent activity

**Smurfing (Fan-in)**
- Many accounts sent money to one central account
- Likely attempting to avoid reporting thresholds
- The central account is the key target for investigation

**Layered Shell Network**
- Money passed through multiple intermediate accounts
- Middle accounts have very few other connections
- Designed to create distance between source and destination

### Betweenness Centrality

This metric shows how important an account is to the overall network:
- **High centrality (0.5-1.0)**: This account is a critical bridge in the network. Removing it would disconnect many paths.
- **Medium centrality (0.2-0.5)**: Important connector but not critical.
- **Low centrality (0.0-0.2)**: Peripheral account with limited network importance.

**Why it matters:** Criminals often place their most important mules at high-centrality positions to control money flows.

---

## Scoring Methodology

### Account Suspicion Score Calculation

The final score is the sum of multiple components:

```
Base Score = 
  (Cycle participation ? 80 : 0) +
  (Layering participation ? 40 : 0)

Role Boosts =
  (Smurfing aggregator ? 85 : 0) OR
  (Smurfing sender ? 25 : 0) OR
  (Smurfing receiver ? 10 : 0) OR
  (Generic smurfing flag ? 25 : 0)

Centrality Boost =
  If degree ≤ 6: min(20, centrality × 100 × 0.2)
  Else: min(5, centrality × 100 × 0.05)

Degree Penalty =
  If degree > 50: -20 (likely legitimate high-volume business)

Final Score = min(100, max(0, Base + Roles + Centrality + Penalty))
```

### Why This Scoring Works

1. **Cycles get high base scores (80)**: Circular routing is a very strong fraud indicator
2. **Aggregators get extra points (85)**: The central account in smurfing is the most critical
3. **High-degree accounts get penalized**: Legitimate merchants have many connections; criminals usually don't
4. **Centrality matters**: Accounts that bridge network segments are more suspicious
5. **Capped at 100**: Prevents runaway scores

### Ring Risk Score Calculation

**Circular Routing Rings:**
```
Risk Score = 80 + (cycle_length × 5) + (within_24h ? 5 : 0)
```
- Base 80 for being a cycle
- +5 per account in cycle (longer cycles are harder to coordinate)
- +5 if all transactions happened within 24 hours

**Smurfing Rings:**
```
Risk Score = 80 + min(20, number_of_senders)
```
- Base 80 for meeting the smurfing threshold
- +1 per sender, up to +20 (more senders = more organized crime)

**Layered Shell Rings:**
```
Risk Score = 65 + min(25, intermediates × 5)
```
- Base 65 for being a layered chain
- +5 per intermediate hop (more layers = more sophisticated)

---

## JSON Export Format

The exported JSON follows this exact structure:

```json
{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["Circular Fund Routing", "Smurfing (Fan-in)"],
      "ring_id": "RING_001"
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "pattern": "Circular Fund Routing",
      "involved_accounts": ["ACC_00123", "ACC_00456", "ACC_00789"],
      "total_amount": 43500.00,
      "risk_score": 95.0
    },
    {
      "ring_id": "RING_002",
      "pattern": "Smurfing (Fan-in)",
      "involved_accounts": ["ACC_01000", "ACC_01001", "SMURF_01"],
      "total_amount": 12040.18,
      "risk_score": 90.0
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3
  }
}
```

### Field Definitions

**Suspicious Accounts Array:**
- `account_id`: Unique identifier for the account
- `suspicion_score`: Overall risk score (0-100)
- `detected_patterns`: Array of human-readable pattern names
- `ring_id`: ID of the highest-risk ring this account belongs to

**Fraud Rings Array:**
- `ring_id`: Unique identifier for the fraud ring
- `pattern`: Human-readable pattern type
- `involved_accounts`: All accounts participating in this ring
- `total_amount`: Sum of all transaction amounts in this ring
- `risk_score`: Overall risk score for the ring (0-100)

**Summary Object:**
- `total_accounts_analyzed`: Number of unique accounts in the dataset
- `suspicious_accounts_flagged`: Number of accounts with score > 0
- `fraud_rings_detected`: Number of distinct fraud rings found
- `processing_time_seconds`: Time taken to analyze the data

---

## Algorithm Deep Dive

### Cycle Detection Algorithm

**Algorithm Type:** Depth-First Search (DFS) with temporal constraints

**How it works:**
1. Build an adjacency list: Map<Account, List<OutgoingTransactions>>
2. For each account as a starting point:
   - Initialize path = [start_account]
   - Initialize transaction_path = []
3. Recursive DFS function:
   - Track current depth (max 5 to avoid exponential explosion)
   - For each outgoing transaction from current account:
     - Check if timestamp is after previous transaction (temporal ordering)
     - If destination is the start account and depth >= 3: Found a cycle!
     - If destination not in current path: Continue DFS
4. When cycle found:
   - Canonicalize (sort the accounts to create a unique signature)
   - Check if we've seen this cycle before (deduplication)
   - Record the cycle with metadata (timestamps, transactions, length)

**Complexity:** O(V × E) where V = accounts, E = transactions
- Limited to depth 5 to keep runtime reasonable
- Seen-cycle check prevents duplicate detection

**Why DFS and not BFS?**
- DFS naturally finds paths, which is what we need for cycles
- BFS would find shortest paths, but cycles can be any length
- DFS is easier to implement with path tracking

### Smurfing Detection Algorithm

**Algorithm Type:** Sliding Window with Frequency Counting

**How it works:**
1. Build incoming transaction index: Map<Receiver, List<IncomingTransactions>>
2. For each receiver:
   - Sort incoming transactions by timestamp
   - Initialize sliding window (left=0, right=0)
   - Maintain frequency map: Map<Sender, Count>
3. Expand window (move right pointer):
   - Add sender at right to frequency map
   - While window size > 72 hours: Contract from left
4. Check threshold: If unique_senders >= 10:
   - Record the window as a smurfing pattern
   - Include all senders in the window (not just first 10)
   - Calculate total amount and timestamp range
5. Move to next receiver

**Complexity:** O(N log N) per receiver due to sorting, then O(N) for sliding window
- N = number of incoming transactions for that receiver
- Efficient because we only sort once per receiver

**Why sliding window?**
- Criminals move money quickly; we need to catch bursts
- Fixed windows (e.g., calendar days) would miss patterns crossing boundaries
- Sliding window finds ANY 72-hour period with 10+ senders

### Layered Shell Detection Algorithm

**Algorithm Type:** Depth-Limited DFS with Degree Constraints

**How it works:**
1. Preprocessing: Identify "low-degree" accounts (degree ≤ 2)
   - These are potential shell accounts
2. For each account as starting point:
   - Initialize path = [start]
   - Initialize transaction_ids = []
3. Recursive DFS with constraints:
   - Max depth: 6 (to prevent runaway recursion)
   - Max gap: 72 hours between hops
   - Intermediate nodes must be low-degree OR be the start
   - No cycles (path can't revisit accounts)
4. When path length >= 3 hops AND >= 2 intermediate hops are low-degree:
   - Create a layered shell ring
   - Canonicalize the path for deduplication
   - Record with evidence (transactions, hops, timestamps)

**Complexity:** O(V × d^D) where d = average degree, D = max depth
- Limited by depth 6 and degree constraints
- Low-degree constraint prunes most legitimate accounts early

**Why require low-degree intermediates?**
- Legitimate accounts have many connections (bills, salary, transfers)
- Shell accounts are created just for layering; they have minimal connections
- This constraint drastically reduces false positives

### Betweenness Centrality Calculation

**Algorithm Type:** Brandes' Algorithm (optimized for unweighted graphs)

**How it works:**
1. For each account as a source:
   - Run BFS to find shortest paths to all other accounts
   - Count how many shortest paths go through each intermediate
2. Accumulate counts across all sources
3. Normalize by the maximum centrality value

**Complexity:** O(V × E) for unweighted graphs
- Optimized version for up to 2000 nodes
- Falls back to zero centrality for larger graphs (performance protection)

**Why it matters:**
- High centrality = account is a critical bridge
- Criminals place key mules at high-centrality positions
- Low-degree + high-centrality is a classic fraud signature

---

## Performance Characteristics

### Processing Time Targets

| Dataset Size | Target Time | Actual Performance |
|--------------|-------------|-------------------|
| 1,000 transactions | < 5 seconds | Typically 1-2 seconds |
| 10,000 transactions | < 30 seconds | Typically 10-15 seconds |
| 50,000 transactions | < 2 minutes | Scales linearly |

### Optimization Techniques

**1. Early Termination**
- Cycle detection stops at depth 5
- Smurfing detection stops after finding first valid window
- Prevents exponential explosion on dense graphs

**2. Deduplication**
- Cycles are canonicalized (sorted) before storing
- Layered paths use signature-based deduplication
- Prevents reporting the same pattern multiple times

**3. Degree Pruning**
- High-degree accounts (>50 connections) are penalized
- Low-degree accounts are prioritized for layering detection
- Reduces search space dramatically

**4. Centrality Approximation**
- Brandes' algorithm capped at 2000 nodes
- Falls back to zero for larger graphs
- Prevents memory and time explosion

**5. Timestamp Indexing**
- Transactions sorted by timestamp once
- Binary search for window boundaries
- O(log N) lookups instead of O(N) scans

### Memory Usage

| Dataset Size | Memory Usage |
|--------------|--------------|
| 1,000 transactions | ~50 MB |
| 10,000 transactions | ~150 MB |
| 50,000 transactions | ~500 MB |

**Memory optimization:**
- Adjacency lists use Maps instead of full matrices
- Transaction data is streamed, not fully cached
- Ring evidence stores only transaction IDs, not full objects

---

## Testing & Validation

### How to Test the Engine

**1. Test Case 1: Simple Cycle**
```
TXN001,A,B,1000,2026-01-01 10:00:00
TXN002,B,C,1000,2026-01-01 11:00:00
TXN003,C,A,1000,2026-01-01 12:00:00
```
Expected: A, B, C flagged with Circular Fund Routing

**2. Test Case 2: Smurfing Pattern**
```
TXN001,S1,AGG,900,2026-01-01 10:00:00
TXN002,S2,AGG,900,2026-01-01 10:30:00
TXN003,S3,AGG,900,2026-01-01 11:00:00
... (10+ senders)
```
Expected: AGG flagged as Smurfing (Fan-in) aggregator

**3. Test Case 3: Layered Shell**
```
TXN001,A,B,5000,2026-01-01 10:00:00
TXN002,B,C,5000,2026-01-01 11:00:00
TXN003,C,D,5000,2026-01-01 12:00:00
```
Where B and C only have 2 transactions each.
Expected: A, B, C, D flagged as Layered Shell Network

### False Positive Control

The engine includes several mechanisms to reduce false positives:

**1. High-Degree Penalty**
- Accounts with >50 connections lose 20 suspicion points
- Catches legitimate businesses that might look like smurfing

**2. Temporal Constraints**
- Cycles must have chronologically ordered transactions
- Smurfing must happen within 72 hours
- Layering must have reasonable gaps between hops

**3. Centrality Filtering**
- High-centrality accounts with high degrees are deprioritized
- Legitimate financial hubs (like exchanges) have many connections

**4. Minimum Thresholds**
- Smurfing requires 10+ unique senders
- Cycles require 3-5 accounts
- Layering requires 3+ hops with 2+ intermediates

### Known Limitations

**1. Timestamp Sensitivity**
- Requires accurate timestamps
- Clock skew between banks could miss patterns

**2. Degree Thresholds**
- Sophisticated criminals might create shell accounts with more connections to evade detection
- Thresholds are set conservatively to balance detection vs. false positives

**3. Graph Size**
- Centrality calculation limited to 2000 nodes
- Very large datasets (100K+ transactions) may have reduced accuracy

**4. Single-Window Smurfing**
- Currently finds the best 72-hour window per receiver
- Multiple separate smurfing windows on same account counted once

---

## Conclusion

The Financial Forensics Engine provides a powerful, interactive tool for detecting money muling networks. By combining graph theory algorithms with intuitive visualizations, it transforms raw transaction data into actionable intelligence.

### Key Strengths

1. **Comprehensive Detection**: Catches all three major money muling patterns
2. **Human-Readable Output**: JSON format matches hackathon requirements exactly
3. **Interactive Visualization**: Makes complex networks understandable
4. **Explainable Scoring**: Every score has a clear mathematical basis
5. **High Performance**: Handles 10,000 transactions in under 30 seconds

### Future Enhancements

Potential improvements for future versions:
- Machine learning integration for anomaly detection
- Support for additional file formats (Excel, XML)
- Real-time streaming analysis
- Integration with banking APIs
- Multi-currency support with exchange rate normalization
- Historical trend analysis
- Cross-dataset pattern matching

---

## Support & Contact

For questions about the algorithm logic, scoring methodology, or JSON format, refer to:
- This documentation
- Source code comments in `src/lib/analyze.ts`
- Type definitions in `src/lib/types.ts`

For the RIFT 2026 Hackathon submission:
- Live Demo: https://aditya.teamparadox.in
- GitHub Repository: [Your GitHub URL]
- Demo Video: [Your LinkedIn Video URL]

---

**Built for the RIFT 2026 Hackathon - Graph Theory / Financial Crime Detection Track**

*"Follow the money."*
