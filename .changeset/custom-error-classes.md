---
"@eclesia/indexer-engine": minor
---

Add custom error classes with context for better error tracking and debugging. New error classes include:
- IndexerError: Base error class with code and context fields
- ConfigurationError: Invalid or missing configuration
- RPCError: RPC connection and communication failures (includes endpoint and height)
- DatabaseError: Database operation failures (includes operation and query)
- BlockProcessingError: Block data validation and processing errors (includes height)
- ModuleError: Module initialization failures (includes module name)
- GenesisError: Genesis file parsing errors (includes file path)

All error classes extend the base IndexerError with proper stack traces and additional context data for easier debugging and monitoring.
