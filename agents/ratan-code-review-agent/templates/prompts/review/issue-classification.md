Categories and Sub-Categories:

| Category | Sub-Category | Description | Priority | Severity | Effort |
|---|---|---|---|---|---|
| 🐛 Logic & Functionality | Incorrect Business Logic | The code doesn't implement the required functionality as specified in the user story or ticket. | P1 | S1-S2 | Medium-High |
|  | State Management Bug | Frontend state becomes inconsistent, leading to UI that is out of sync with the application's data. (React/TS) | P2 | S2 | Medium |
|  | Incorrect Data Transformation | Data is incorrectly mapped or transformed between layers (e.g., DTO to Entity), causing data corruption or loss. | P2 | S2 | Low-Medium |
|  | Unhandled Edge Case | Fails to account for boundary values, empty inputs, or unexpected user behavior. | P2 | S2 | Medium |
|  | Null Pointer Exception (NPE) | Failure to check for null values, leading to runtime crashes. (Java: NullPointerException, TS: Cannot read properties of undefined) | P2 | S2 | Low |
|  | Incorrect Error Handling | Swallowing exceptions, returning vague error messages, or failing to handle API error responses gracefully. | P2 | S2-S3 | Low-Medium |
|  | Race Condition / Concurrency Issue | Multiple threads access shared resources improperly, leading to unpredictable behavior. (Primarily Java/Spring) | P1-P2 | S1-S2 | High |
| ⚡ Performance | Inefficient Algorithm/Query | Using a brute-force approach where a more optimal one exists (e.g., O(n^2) instead of O(n \\log n)) or an unindexed DB query. | P2 | S2 | Medium-High |
|  | N+1 Query Problem | Lazily loading related entities within a loop, causing an excessive number of database calls. (Spring/JPA) | P2 | S2 | Medium |
|  | Memory Leak | Objects are not being garbage collected, leading to increasing memory usage and eventual system failure. | P2 | S1-S2 | High |
|  | Blocking I/O on Main Thread | Performing long-running network or file operations on a critical thread, blocking execution and making the UI unresponsive. | P2 | S2 | Medium |
|  | Excessive Re-renders | React component re-renders unnecessarily due to improper state management or memoization. (React) | P3 | S3 | Low-Medium |
|  | Large Bundle Size | Importing large libraries or failing to code-split, resulting in slow initial page loads. (React/TS) | P3 | S3 | Medium |
| 🛡️ Security | Injection Vulnerability | Code is susceptible to SQL, NoSQL, or other types of injection attacks by not sanitizing inputs. | P1 | S1 | Medium |
|  | Cross-Site Scripting (XSS) | User-supplied data is rendered without proper escaping, allowing attackers to execute scripts in users' browsers. | P1 | S1 | Low-Medium |
|  | Cross-Site Request Forgery (CSRF) | Missing or improper validation of anti-CSRF tokens for state-changing requests. | P1 | S1 | Medium |
|  | Missing Auth Checks | An endpoint or component is accessible without proper authentication or authorization, exposing sensitive data or actions. | P1 | S1 | Low-Medium |
|  | Sensitive Data Exposure | Logging sensitive user data (passwords, PII) in plain text or exposing it in API responses. | P1 | S1 | Low |
|  | Hardcoded Secrets | API keys, passwords, or other secrets are committed directly into the source code. | P1 | S1 | Low |
| 🎨 Maintainability & Readability | Dead Code | Unused variables, functions, or imports that clutter the codebase. | P4 | S4 | Low |
|  | High Cyclomatic Complexity | A function or method has too many conditional branches, making it difficult to understand, test, and maintain. | P3 | S3 | Medium |
|  | Leaky Abstraction | An abstraction exposes implementation details that its consumer shouldn't need to be aware of. | P3 | S3 | Medium |
|  | Inconsistent Naming | Variables, functions, or classes don't follow the established project naming conventions. | P4 | S4 | Low |
|  | Code Duplication (Not DRY) | The same block of code is repeated in multiple places instead of being extracted into a reusable function or component. | P3 | S3 | Medium |
|  | Overly Complex Function/Component | A single function or component violates the Single Responsibility Principle (SRP). | P3 | S3 | Medium-High |
|  | Magic Numbers/Strings | Using unnamed, hardcoded constants instead of named variables. | P4 | S3 | Low |
| ✅ Testing | Insufficient Test Coverage | Critical logic paths, branches, or edge cases are not covered by tests. | P2 | S2 | Medium |
|  | Non-Deterministic (Flaky) Test | A test that passes and fails intermittently without any code changes. | P2 | S2 | High |
|  | Hardcoded Test Data | Tests rely on specific, brittle data that makes them difficult to maintain or adapt to changes. | P3 | S3 | Low-Medium |
|  | Ignoring Test Failures | A test is commented out or marked to be ignored (@Ignore) because it's failing, instead of being fixed. | P2 | S2 | Varies |
| 🏗️ Framework & Language | Prop Drilling | Passing props down through multiple layers of components instead of using Context or a state management library. (React) | P3 | S3 | Medium |
|  | Improper State Management | Mutating state directly or misusing hooks (useEffect, useState). (React) | P2 | S2 | Medium |
|  | Incorrect Type Usage | Using any excessively or incorrect type definitions, defeating the purpose of TypeScript. (TS) | P3 | S2-S3 | Low-Medium |
|  | Misuse of Annotations | Incorrectly applying Spring annotations (e.g., @Transactional on a private method). (Spring) | P3 | S2 | Low |
|  | Improper Exception Translation | Allowing low-level exceptions (e.g., SQLException) to propagate up to higher layers of the application. (Spring/Java) | P3 | S3 | Low |
| 🗃️ Database & SQL | Non-SARGable Query | Applying a function to a column in a WHERE clause (e.g., WHERE YEAR(order_date) = 2025), which prevents the database from using an index. | P3 | S2 | Medium |
|  | Using SELECT * | Retrieving all columns from a table when only a few are needed, causing unnecessary I/O and network traffic. | P4 | S3 | Low |
|  | Missing or Incorrect Indexes | A frequent query has to perform a full table scan because there is no supporting index, causing major performance degradation. | P2 | S2 | Medium |
|  | Transaction Mismanagement | Holding a database transaction open for too long, which can cause deadlocks and block other processes. | P2 | S2 | Medium |
|  | Lack of Foreign Key Constraints | Failing to define foreign key relationships in the DDL, which compromises data integrity. | P3 | S2 | Low |
| ⚙️ Configuration & Build | Dependency Version Conflict | Incompatible library versions causing NoClassDefFoundError or other cryptic build or runtime errors. | P2 | S2 | Medium-High |
|  | Inconsistent Environment Config | Dev, staging, and prod environments behave differently due to configuration drift. | P2 | S2 | Low-Medium |
|  | Inefficient CI/CD Pipeline | The build and deployment process is excessively slow, brittle, or requires manual intervention. | P3 | S3 | High |

For each issue, analyze the message, suggestion, and suggestion_code to determine the most appropriate category and sub-category. If an issue does not fit any of the above categories, classify it as "Other" with a sub-category of "Uncategorized".
