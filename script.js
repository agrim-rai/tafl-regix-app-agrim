
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
            const dual = document.getElementById('equivDualWrap');
            const testLength = parseInt(document.getElementById('maxLength').value) || 8;
            dual.style.display = 'none';

            let ast1;
            let ast2;
            let e1;
            let e2;
            try {
                ast1 = new RegexParser(regex1).parse();
                ast2 = new RegexParser(regex2).parse();
                e1 = astToEngineRegex(ast1);
                e2 = astToEngineRegex(ast2);
            } catch (err) {
                resultDiv.innerHTML = '<div class="equiv-result error">Error: ' + escapeHtml(err.message) + '</div>';
                return;
            }

            const engV1 = new RegexEngine();
            const engV2 = new RegexEngine();
            const c1 = engV1.compile(e1, true, true);
            const c2 = engV2.compile(e2, true, true);
            if (!c1 || !c2) {
                resultDiv.innerHTML = '<div class="equiv-result error">One or both expressions could not be compiled for DFA analysis.</div>';
                return;
            }

            window.equivViz1.setStepData(lastDfaToStep(c1.lastDfa));
            window.equivViz2.setStepData(lastDfaToStep(c2.lastDfa));
            dual.style.display = 'flex';

            const checker = new RegexEngine();
            const dfaSame = checker.checkEquivalence(e1, e2);

            const strings1 = new Set(generateFromAST(ast1, testLength, 1000));
            const strings2 = new Set(generateFromAST(ast2, testLength, 1000));
            let strEquiv = true;
            let counterexample = null;
            let inFirst = true;
            for (const s of strings1) {
                if (!strings2.has(s)) {
                    strEquiv = false;
                    counterexample = s;
                    inFirst = true;
                    break;
                }
            }
            if (strEquiv) {
                for (const s of strings2) {
                    if (!strings1.has(s)) {
                        strEquiv = false;
                        counterexample = s;
                        inFirst = false;
                        break;
                    }
                }
            }

            let html = '';
            if (dfaSame) {
                html += '<div class="equiv-result equivalent">✓ Same language (minimized DFA comparison)<br><small>Product construction found no accepting-state mismatch.</small></div>';
            } else {
                html += '<div class="equiv-result not-equivalent">✗ Different languages (DFA-level)<br><small>The two minimized automata are not equivalent.</small></div>';
            }
            if (!strEquiv && counterexample !== null) {
                const displayStr = counterexample === '' ? 'ε (empty string)' : '"' + escapeHtml(counterexample) + '"';
                html += '<div class="equiv-result not-equivalent" style="margin-top:10px;"><small>Bounded sample (length ≤ ' + testLength + '): ' + displayStr + ' appears only in the ' + (inFirst ? 'first' : 'second') + ' language among sampled strings.</small></div>';
            } else if (strEquiv) {
                html += '<div class="equiv-result equivalent" style="margin-top:10px;opacity:0.92;"><small>Bounded string sample (length ≤ ' + testLength + '): no mismatch in sampled sets — ' + strings1.size + ' vs ' + strings2.size + ' strings.</small></div>';
            }
            resultDiv.innerHTML = html;
        }
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function astNeedsRepeatWrap(node) {
            return node.type === 'union' || node.type === 'concat' || node.type === 'star'
                || node.type === 'plus' || node.type === 'optional';
        }

        function astToEngineRegex(node) {
            if (!node) return '';
            switch (node.type) {
                case 'epsilon':
                    return 'ε';
                case 'empty':
                    return '∅';
                case 'literal':
                    return node.value;
                case 'union':
                    return astToEngineRegex(node.left) + '+' + astToEngineRegex(node.right);
                case 'concat':
                    return astToEngineRegex(node.left) + astToEngineRegex(node.right);
                case 'star': {
                    const inner = astToEngineRegex(node.child);
                    const w = astNeedsRepeatWrap(node.child) ? '(' + inner + ')' : inner;
                    return w + '*';
                }
                case 'plus': {
                    const inner = astToEngineRegex(node.child);
                    const w = astNeedsRepeatWrap(node.child) ? '(' + inner + ')' : inner;
                    return w + w + '*';
                }
                case 'optional': {
                    const inner = astToEngineRegex(node.child);
                    const w = astNeedsRepeatWrap(node.child) ? '(' + inner + ')' : inner;
                    return w + '?';
                }
                default:
                    return '';
            }
        }

        function lastDfaToStep(lastDfa) {
            const states = {};
            for (let i = 0; i < lastDfa.states.length; i++) {
                const s = lastDfa.states[i];
                const formattedTransitions = {};
                for (const c in s.transitions) {
                    formattedTransitions[c] = [s.transitions[c]];
                }
                states[s.id] = {
                    id: s.id,
                    transitions: formattedTransitions,
                    isEnd: s.isEnd
                };
            }
            return { description: 'DFA', states, activeStates: [] };
        }

        const dfaUi = {
            engine: null,
            visualizer: null,
            steps: [],
            stepIndex: -1,
            playback: null,
            unminimizedDfa: null,
            stepLogExpanded: false
        };

        function dfaSnapshotSteps(sourceSteps) {
            return sourceSteps.map(function(s) {
                return {
                    description: s.description || '',
                    states: s.states,
                    activeStates: s.activeStates ? s.activeStates.slice() : []
                };
            });
        }

        function dfaRebuildStepLogList() {
            const ol = document.getElementById('dfaStepLogList');
            const countEl = document.getElementById('dfaLogCount');
            const panel = document.getElementById('dfaStepLogPanel');
            if (!ol || !panel) return;
            ol.innerHTML = '';
            if (countEl) {
                countEl.textContent = dfaUi.steps.length ? dfaUi.steps.length + ' steps' : '';
            }
            for (let i = 0; i < dfaUi.steps.length; i++) {
                const li = document.createElement('li');
                li.className = 'dfa-log-row';
                li.dataset.index = String(i);
                li.textContent = dfaUi.steps[i].description;
                li.addEventListener('click', function() {
                    dfaStopPlayback();
                    dfaRenderStep(i);
                });
                ol.appendChild(li);
            }
        }

        function dfaUpdateCollapsedSummary() {
            const el = document.getElementById('dfaLogCollapsedSummary');
            if (!el) return;
            if (!dfaUi.steps.length) {
                el.textContent = '';
                return;
            }
            const last = dfaUi.steps.length - 1;
            const s = dfaUi.steps[last];
            el.textContent = 'Step ' + (last + 1) + '/' + dfaUi.steps.length + ' (final): ' + s.description;
        }

        function dfaRefreshLogHighlights() {
            const rows = document.querySelectorAll('#dfaStepLogList .dfa-log-row');
            let activeRow = null;
            rows.forEach(function(row) {
                const idx = parseInt(row.dataset.index, 10);
                const on = idx === dfaUi.stepIndex;
                row.classList.toggle('active', on);
                if (on) activeRow = row;
            });
            if (activeRow && dfaUi.stepLogExpanded && !dfaUi.playback) {
                activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }

        function dfaRefreshStepLogUi() {
            dfaUpdateCollapsedSummary();
            dfaRefreshLogHighlights();
        }

        function dfaSetLogExpanded(expanded) {
            dfaUi.stepLogExpanded = !!expanded;
            const panel = document.getElementById('dfaStepLogPanel');
            const exp = document.getElementById('dfaStepLogExpanded');
            const btn = document.getElementById('dfaLogToggle');
            const txt = document.getElementById('dfaLogToggleText');
            if (!panel || !exp || !btn) return;
            panel.classList.toggle('is-expanded', dfaUi.stepLogExpanded);
            if (dfaUi.stepLogExpanded) {
                exp.removeAttribute('hidden');
                btn.setAttribute('aria-expanded', 'true');
                if (txt) txt.textContent = 'Collapse construction log';
            } else {
                exp.setAttribute('hidden', '');
                btn.setAttribute('aria-expanded', 'false');
                if (txt) txt.textContent = 'Expand construction log';
            }
            dfaRefreshStepLogUi();
        }

        function dfaToggleStepLog() {
            dfaSetLogExpanded(!dfaUi.stepLogExpanded);
        }

        function dfaHideStepLogPanel() {
            const panel = document.getElementById('dfaStepLogPanel');
            if (panel) panel.style.display = 'none';
        }

        function dfaShowStepLogPanel() {
            const panel = document.getElementById('dfaStepLogPanel');
            if (panel) panel.style.display = 'block';
        }

        function dfaShowError(msg) {
            const el = document.getElementById('dfaVizError');
            el.textContent = msg;
            el.style.display = msg ? 'block' : 'none';
        }

        function dfaUpdateControls() {
            const prev = document.getElementById('dfaStepPrev');
            const next = document.getElementById('dfaStepNext');
            if (!prev || !next) return;
            prev.disabled = dfaUi.stepIndex <= 0;
            next.disabled = dfaUi.stepIndex >= dfaUi.steps.length - 1;
        }

        function dfaRenderStep(index) {
            if (index < 0 || index >= dfaUi.steps.length) return;
            dfaUi.stepIndex = index;
            const step = dfaUi.steps[index];
            dfaUi.visualizer.setStepData(step);
            const desc = document.getElementById('dfaStepDescription');
            if (desc) {
                desc.textContent = 'Step ' + (index + 1) + '/' + dfaUi.steps.length + ': ' + step.description;
            }
            dfaUpdateControls();
            dfaRefreshStepLogUi();
        }

        function dfaStopPlayback() {
            if (dfaUi.playback) {
                clearInterval(dfaUi.playback);
                dfaUi.playback = null;
            }
            const btn = document.getElementById('dfaPlayPause');
            if (btn) btn.textContent = '▶';
        }

        function dfaTogglePlayback() {
            const btn = document.getElementById('dfaPlayPause');
            const slider = document.getElementById('dfaSpeedSlider');
            if (dfaUi.playback) {
                dfaStopPlayback();
                return;
            }
            if (dfaUi.steps.length === 0) return;
            if (dfaUi.stepIndex >= dfaUi.steps.length - 1) {
                dfaUi.stepIndex = -1;
            }
            if (btn) btn.textContent = '⏸';
            const tick = () => {
                if (dfaUi.stepIndex < dfaUi.steps.length - 1) {
                    dfaRenderStep(dfaUi.stepIndex + 1);
                } else {
                    dfaStopPlayback();
                }
            };
            const ms = 2100 - parseInt(slider && slider.value ? slider.value : 900, 10);
            dfaUi.playback = setInterval(tick, Math.max(120, ms));
        }

        function buildDfaVisualization() {
            dfaStopPlayback();
            const regex = document.getElementById('regexInput').value;
            dfaShowError('');
            const minBtn = document.getElementById('dfaMinimizeBtn');
            if (minBtn) minBtn.style.display = 'none';
            dfaUi.unminimizedDfa = null;
            try {
                const parser = new RegexParser(regex);
                const ast = parser.parse();
                const engineStr = astToEngineRegex(ast);
                dfaUi.engine.reset();
                const nfaData = dfaUi.engine.compile(engineStr, false, false);
                if (!nfaData || !nfaData.dfaSteps || nfaData.dfaSteps.length === 0) {
                    throw new Error('Could not compile to DFA steps.');
                }
                dfaUi.steps = dfaSnapshotSteps(nfaData.dfaSteps);
                dfaUi.unminimizedDfa = nfaData.lastDfa;
                dfaRebuildStepLogList();
                dfaShowStepLogPanel();
                if (minBtn) minBtn.style.display = 'inline-block';
                dfaRenderStep(0);
                dfaSetLogExpanded(false);
                dfaTogglePlayback();
            } catch (e) {
                dfaUi.steps = [];
                dfaUi.stepIndex = -1;
                dfaUi.visualizer.clear();
                dfaHideStepLogPanel();
                const ol = document.getElementById('dfaStepLogList');
                if (ol) ol.innerHTML = '';
                dfaShowError(e.message || String(e));
                const desc = document.getElementById('dfaStepDescription');
                if (desc) desc.textContent = 'Fix the regex or unsupported construct for the DFA engine.';
            }
        }

        function minimizeDfaUi() {
            if (!dfaUi.unminimizedDfa || !dfaUi.engine) return;
            dfaStopPlayback();
            try {
                dfaUi.engine.minimizeDfa(dfaUi.unminimizedDfa, false);
                dfaUi.steps = dfaSnapshotSteps(dfaUi.engine.dfaSteps);
                dfaUi.unminimizedDfa = null;
                dfaRebuildStepLogList();
                const keepLogOpen = dfaUi.stepLogExpanded;
                const minBtn = document.getElementById('dfaMinimizeBtn');
                if (minBtn) minBtn.style.display = 'none';
                dfaRenderStep(dfaUi.steps.length - 1);
                dfaSetLogExpanded(keepLogOpen);
            } catch (e) {
                dfaShowError(e.message || String(e));
            }
        }

        function initAppTabs() {
            const tabs = document.querySelectorAll('.app-tab');
            const panes = {
                generate: document.getElementById('tab-pane-generate'),
                dfa: document.getElementById('tab-pane-dfa'),
                equiv: document.getElementById('tab-pane-equiv')
            };
            tabs.forEach((tab) => {
                tab.addEventListener('click', () => {
                    const name = tab.getAttribute('data-tab');
                    tabs.forEach((t) => {
                        t.classList.toggle('active', t === tab);
                        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
                    });
                    Object.keys(panes).forEach((k) => {
                        if (panes[k]) panes[k].classList.toggle('active', k === name);
                    });
                });
            });
        }

        function initTheoryPromo() {
            var lsKey = 'taflTheoryPromoDismissed';
            var ssKey = 'taflTheoryPromoSessionClosed';
            var modal = document.getElementById('theoryPromoModal');
            if (!modal) return;
            if (localStorage.getItem(lsKey) === '1' || sessionStorage.getItem(ssKey) === '1') return;
            modal.removeAttribute('hidden');
            function closeModal() {
                modal.setAttribute('hidden', '');
            }
            var later = document.getElementById('theoryPromoLater');
            var closeBtn = document.getElementById('theoryPromoClose');
            var never = document.getElementById('theoryPromoNever');
            var open = document.getElementById('theoryPromoOpen');
            function dismissSession() {
                sessionStorage.setItem(ssKey, '1');
                closeModal();
            }
            if (later) {
                later.addEventListener('click', dismissSession);
            }
            if (closeBtn) {
                closeBtn.addEventListener('click', dismissSession);
            }
            modal.addEventListener('click', function(e) {
                if (e.target === modal) dismissSession();
            });
            if (never) {
                never.addEventListener('click', function() {
                    localStorage.setItem(lsKey, '1');
                    closeModal();
                });
            }
            if (open) {
                open.addEventListener('click', function() {
                    localStorage.setItem(lsKey, '1');
                });
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            dfaUi.engine = new RegexEngine();
            dfaUi.visualizer = new Visualizer('dfaCanvas');
            window.equivViz1 = new Visualizer('equivCanvas1');
            window.equivViz2 = new Visualizer('equivCanvas2');

            initTheoryPromo();

            initAppTabs();

            document.getElementById('dfaBuildBtn').addEventListener('click', buildDfaVisualization);
            document.getElementById('dfaMinimizeBtn').addEventListener('click', minimizeDfaUi);
            document.getElementById('dfaLogToggle').addEventListener('click', dfaToggleStepLog);
            document.getElementById('dfaPlayPause').addEventListener('click', dfaTogglePlayback);
            document.getElementById('dfaStepNext').addEventListener('click', () => {
                dfaStopPlayback();
                if (dfaUi.stepIndex < dfaUi.steps.length - 1) dfaRenderStep(dfaUi.stepIndex + 1);
            });
            document.getElementById('dfaStepPrev').addEventListener('click', () => {
                dfaStopPlayback();
                if (dfaUi.stepIndex > 0) dfaRenderStep(dfaUi.stepIndex - 1);
            });
            document.getElementById('dfaSpeedSlider').addEventListener('input', () => {
                if (dfaUi.playback) {
                    dfaStopPlayback();
                    dfaTogglePlayback();
                }
            });

            document.getElementById('regexInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') generateStrings();
            });
            document.getElementById('equivInput1').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') checkEquivalence();
            });
            document.getElementById('equivInput2').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') checkEquivalence();
            });

            generateStrings();
        });
