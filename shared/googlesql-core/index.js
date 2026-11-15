'use strict';
// Canonical GoogleSQL parser/tokenizer/catalog; no VSCode or network dependencies.
module.exports={...require('./sql-scope'),...require('./tokenize'),...require('./completion-context'),...require('./completion')};
