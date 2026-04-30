
        // ============================================
        // REGEX PARSER AND STRING GENERATOR
        // ============================================
        class RegexParser {
            constructor(pattern) {
                this.pattern = pattern.replace(/\s/g, '');
                this.pos = 0;
            }
            parse() {
                if (this.pattern.length === 0) {
                    return { type: 'epsilon' };
                }
                const ast = this.parseUnion();
                if (this.pos < this.pattern.length) {
                    throw new Error(`Unexpected character '${this.pattern[this.pos]}' at position ${this.pos}`);
                }
                return ast;
            }
            parseUnion() {
                let left = this.parseConcat();
                while (this.pos < this.pattern.length && this.pattern[this.pos] === '|') {
                    this.pos++;
                    const right = this.parseConcat();
                    left = { type: 'union', left, right };
                }
                return left;
            }
            parseConcat() {
                let nodes = [];
                while (this.pos < this.pattern.length && 
                       this.pattern[this.pos] !== ')' && 
                       this.pattern[this.pos] !== '|') {
                    nodes.push(this.parseQuantifier());
                }
                if (nodes.length === 0) {
                    return { type: 'epsilon' };
                }
                if (nodes.length === 1) {
                    return nodes[0];
                }
                let result = nodes[0];
                for (let i = 1; i < nodes.length; i++) {
                    result = { type: 'concat', left: result, right: nodes[i] };
                }
                return result;
            }
            parseQuantifier() {
                let base = this.parseAtom();
                while (this.pos < this.pattern.length) {
                    const ch = this.pattern[this.pos];
                    if (ch === '*') {
                        this.pos++;
                        base = { type: 'star', child: base };
                    } else if (ch === '+') {
                        this.pos++;
                        base = { type: 'plus', child: base };
                    } else if (ch === '?') {
                        this.pos++;
                        base = { type: 'optional', child: base };
                    } else {
                        break;
                    }
                }
                return base;
            }
            parseAtom() {
                if (this.pos >= this.pattern.length) {
                    throw new Error('Unexpected end of pattern');
                }
                const ch = this.pattern[this.pos];
                if (ch === '(') {
                    this.pos++;
                    const inner = this.parseUnion();
                    if (this.pos >= this.pattern.length || this.pattern[this.pos] !== ')') {
                        throw new Error('Missing closing parenthesis');
                    }
                    this.pos++;
                    return inner;
                }
                if (ch === 'ε' || (ch === '\\' && this.pattern[this.pos + 1] === 'e')) {
                    this.pos += (ch === 'ε') ? 1 : 2;
                    return { type: 'epsilon' };
                }
                if (ch === '∅' || (ch === '\\' && this.pattern[this.pos + 1] === '0')) {
                    this.pos += (ch === '∅') ? 1 : 2;
                    return { type: 'empty' };
                }
                if (ch === '*' || ch === '+' || ch === '?' || ch === '|' || ch === ')') {
                    throw new Error(`Unexpected operator '${ch}' at position ${this.pos}`);
                }
                this.pos++;
                return { type: 'literal', value: ch };
            }
        }
        // Generate strings from AST using memoized bounded expansion
        function generateFromAST(ast, maxLength, maxStrings) {
            const nodeIds = new WeakMap();
            let nodeCounter = 0;
            const cache = new Map();

            function getNodeId(node) {
                if (!nodeIds.has(node)) {
                    nodeIds.set(node, nodeCounter++);
                }
                return nodeIds.get(node);
            }

            function addWithLimit(target, value) {
                if (target.size >= maxStrings) return false;
                target.add(value);
                return target.size < maxStrings;
            }

            function combineSets(leftSet, rightSet, remainingLength) {
                const out = new Set();
                for (const left of leftSet) {
                    if (out.size >= maxStrings) break;
                    for (const right of rightSet) {
                        if (out.size >= maxStrings) break;
                        const merged = left + right;
                        if (merged.length <= remainingLength) {
                            out.add(merged);
                        }
                    }
                }
                return out;
            }

            function expand(node, remainingLength) {
                const cacheKey = `${getNodeId(node)}:${remainingLength}`;
                if (cache.has(cacheKey)) {
                    return cache.get(cacheKey);
                }

                const out = new Set();
                if (remainingLength < 0) {
                    cache.set(cacheKey, out);
                    return out;
                }

                switch (node.type) {
                    case 'epsilon':
                        addWithLimit(out, '');
                        break;
                    case 'empty':
                        break;
                    case 'literal':
                        if (remainingLength >= 1) {
                            addWithLimit(out, node.value);
                        }
                        break;
                    case 'union': {
                        for (const s of expand(node.left, remainingLength)) {
                            if (!addWithLimit(out, s)) break;
                        }
                        for (const s of expand(node.right, remainingLength)) {
                            if (!addWithLimit(out, s)) break;
                        }
                        break;
                    }
                    case 'concat': {
                        const leftSet = expand(node.left, remainingLength);
                        for (const left of leftSet) {
                            if (out.size >= maxStrings) break;
                            const rightMax = remainingLength - left.length;
                            if (rightMax < 0) continue;
                            const rightSet = expand(node.right, rightMax);
                            for (const right of rightSet) {
                                if (!addWithLimit(out, left + right)) break;
                            }
                        }
                        break;
                    }
                    case 'optional': {
                        addWithLimit(out, '');
                        for (const s of expand(node.child, remainingLength)) {
                            if (!addWithLimit(out, s)) break;
                        }
                        break;
                    }
                    case 'star':
                    case 'plus': {
                        const base = Array.from(expand(node.child, remainingLength)).filter(s => s.length > 0);
                        if (node.type === 'star') {
                            addWithLimit(out, '');
                        }
                        if (base.length === 0) {
                            break;
                        }

                        let current = new Set(base);
                        for (const s of current) {
                            if (s.length <= remainingLength && !addWithLimit(out, s)) break;
                        }

                        while (current.size > 0 && out.size < maxStrings) {
                            const next = combineSets(current, new Set(base), remainingLength);
                            const uniqueNext = new Set();
                            for (const candidate of next) {
                                if (!out.has(candidate)) {
                                    uniqueNext.add(candidate);
                                }
                            }
                            if (uniqueNext.size === 0) {
                                break;
                            }
                            for (const s of uniqueNext) {
                                if (!addWithLimit(out, s)) break;
                            }
                            current = uniqueNext;
                        }
                        break;
                    }
                }

                cache.set(cacheKey, out);
                return out;
            }

            const results = Array.from(expand(ast, maxLength));
            return results.sort((a, b) => {
                if (a.length !== b.length) return a.length - b.length;
                return a.localeCompare(b);
            });
        }
        // Create parse tree visualization
        function createParseTreeString(node, indent = '') {
            if (!node) return '';
            
            let result = '';
            const connector = indent ? '├── ' : '';
            const childIndent = indent + (indent ? '│   ' : '    ');
            switch (node.type) {
                case 'epsilon':
                    result = indent + connector + 'ε (empty string)\n';
                    break;
                case 'empty':
                    result = indent + connector + '∅ (empty set)\n';
                    break;
                case 'literal':
                    result = indent + connector + `"${node.value}"\n`;
                    break;
                case 'concat':
                    result = indent + connector + 'CONCAT\n';
                    result += createParseTreeString(node.left, childIndent);
                    result += createParseTreeString(node.right, childIndent);
                    break;
                case 'union':
                    result = indent + connector + 'UNION (|)\n';
                    result += createParseTreeString(node.left, childIndent);
                    result += createParseTreeString(node.right, childIndent);
                    break;
                case 'star':
                    result = indent + connector + 'STAR (*)\n';
                    result += createParseTreeString(node.child, childIndent);
                    break;
                case 'plus':
                    result = indent + connector + 'PLUS (+)\n';
                    result += createParseTreeString(node.child, childIndent);
                    break;
                case 'optional':
                    result = indent + connector + 'OPTIONAL (?)\n';
                    result += createParseTreeString(node.child, childIndent);
                    break;
            }
            return result;
        }
        // ============================================
        // UI FUNCTIONS
        // ============================================
        function insertSymbol(symbol) {
            const input = document.getElementById('regexInput');
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const text = input.value;
            if (symbol === '()') {
                input.value = text.substring(0, start) + '(' + text.substring(start, end) + ')' + text.substring(end);
                input.setSelectionRange(start + 1, end + 1);
            } else {
                input.value = text.substring(0, start) + symbol + text.substring(end);
                input.setSelectionRange(start + symbol.length, start + symbol.length);
            }
            input.focus();
        }
        function loadExample(regex) {
            document.getElementById('regexInput').value = regex;
            generateStrings();
        }
        function clearInput() {
            document.getElementById('regexInput').value = '';
            document.getElementById('stringsList').innerHTML = '<div class="placeholder-block">Click "Generate" to see matching strings</div>';
            document.getElementById('parseTree').innerHTML = '<span class="placeholder-inline">Parse tree will appear here</span>';
            document.getElementById('statsDisplay').innerHTML = '';
            document.getElementById('errorDisplay').innerHTML = '';
        }
        function generateStrings() {
            const regex = document.getElementById('regexInput').value;
            const maxLength = parseInt(document.getElementById('maxLength').value) || 8;
            const maxStrings = parseInt(document.getElementById('maxStrings').value) || 50;
            const errorDisplay = document.getElementById('errorDisplay');
            const stringsList = document.getElementById('stringsList');
            const parseTreeDiv = document.getElementById('parseTree');
            const statsDisplay = document.getElementById('statsDisplay');
            errorDisplay.innerHTML = '';
            try {
                const parser = new RegexParser(regex);
                const ast = parser.parse();
                // Display parse tree
                const treeStr = createParseTreeString(ast);
                parseTreeDiv.textContent = treeStr || 'Empty expression';
                // Generate strings
                const strings = generateFromAST(ast, maxLength, maxStrings);
                // Display strings
                if (strings.length === 0) {
                    stringsList.innerHTML = '<div class="placeholder-block">No strings generated (empty language or constraints too tight)</div>';
                } else {
                    stringsList.innerHTML = strings.map(s => 
                        s === '' 
                            ? '<div class="string-item epsilon">ε (empty string)</div>'
                            : `<div class="string-item">${escapeHtml(s)}</div>`
                    ).join('');
                }
                // Display stats
                const hasEpsilon = strings.includes('');
                const nonEmptyCount = strings.filter(s => s !== '').length;
                statsDisplay.innerHTML = `
                    <div class="stat-item">Total: <span class="stat-value">${strings.length}</span></div>
                    <div class="stat-item">Contains ε: <span class="stat-value">${hasEpsilon ? 'Yes' : 'No'}</span></div>
                    <div class="stat-item">Max length shown: <span class="stat-value">${maxLength}</span></div>
                `;
            } catch (e) {
                errorDisplay.innerHTML = `<div class="error-msg">Error: ${escapeHtml(e.message)}</div>`;
                stringsList.innerHTML = '<div class="placeholder-block">Fix the error above to generate strings</div>';
                parseTreeDiv.innerHTML = '<span class="placeholder-inline">Fix the error to see parse tree</span>';
                statsDisplay.innerHTML = '';
            }
        }
        function checkEquivalence() {
            const regex1 = document.getElementById('equivInput1').value;
            const regex2 = document.getElementById('equivInput2').value;
            const resultDiv = document.getElementById('equivResult');
            const testLength = parseInt(document.getElementById('maxLength').value) || 8;
            try {
                const parser1 = new RegexParser(regex1);
                const ast1 = parser1.parse();
                const parser2 = new RegexParser(regex2);
                const ast2 = parser2.parse();
                // Generate strings for both with a higher limit for equivalence checking
                const strings1 = new Set(generateFromAST(ast1, testLength, 1000));
                const strings2 = new Set(generateFromAST(ast2, testLength, 1000));
                // Check equivalence
                let equivalent = true;
                let counterexample = null;
                let inFirst = true;
                // Check if all strings in set1 are in set2
                for (const s of strings1) {
                    if (!strings2.has(s)) {
                        equivalent = false;
                        counterexample = s;
                        inFirst = true;
                        break;
                    }
                }
                // Check if all strings in set2 are in set1
                if (equivalent) {
                    for (const s of strings2) {
                        if (!strings1.has(s)) {
                            equivalent = false;
                            counterexample = s;
                            inFirst = false;
                            break;
                        }
                    }
                }
                if (equivalent) {
                    resultDiv.innerHTML = `
                        <div class="equiv-result equivalent">
                            ✓ EQUIVALENT (up to length ${testLength})<br>
                            <small>Both expressions accept the same ${strings1.size} string(s)</small>
                        </div>
                    `;
                } else {
                    const displayStr = counterexample === '' ? 'ε (empty string)' : `"${escapeHtml(counterexample)}"`;
                    const whichRegex = inFirst ? 'first' : 'second';
                    resultDiv.innerHTML = `
                        <div class="equiv-result not-equivalent">
                            ✗ NOT EQUIVALENT<br>
                            <small>Counterexample: ${displayStr}<br>
                            Accepted by ${whichRegex} regex only</small>
                        </div>
                    `;
                }
            } catch (e) {
                resultDiv.innerHTML = `<div class="equiv-result error">Error: ${escapeHtml(e.message)}</div>`;
            }
        }
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        // Initialize with default example on page load
        document.addEventListener('DOMContentLoaded', function() {
            generateStrings();
        });
        // Allow Enter key to trigger generation
        document.getElementById('regexInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                generateStrings();
            }
        });
        document.getElementById('equivInput1').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                checkEquivalence();
            }
        });
        document.getElementById('equivInput2').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                checkEquivalence();
            }
        });
