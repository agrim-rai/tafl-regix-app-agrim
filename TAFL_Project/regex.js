class State {
    constructor(id) {
        this.id = id;
        this.transitions = {}; 
    }

    addTransition(char, stateId) {
        if (!this.transitions[char]) {
            this.transitions[char] = [];
        }
        this.transitions[char].push(stateId);
    }
}

class NFAFragment {
    constructor(startStateId, endStateId) {
        this.startStateId = startStateId;
        this.endStateId = endStateId;
    }
}

class RegexEngine {
    constructor() {
        this.states = new Map(); // id -> State
        this.stateCounter = 0;
        this.steps = []; // Array to hold visualization steps
        this.dfaSteps = [];
    }

    reset() {
        this.states.clear();
        this.stateCounter = 0;
        this.steps = [];
        this.dfaSteps = [];
    }

    newState() {
        const id = this.stateCounter++;
        const state = new State(id);
        this.states.set(id, state);
        return state;
    }

    recordStep(description, currentFragments, silent = false) {
        if (silent) return;
        const statesSnapshot = {};
        for (let [id, state] of this.states.entries()) {
            statesSnapshot[id] = {
                id: state.id,
                transitions: JSON.parse(JSON.stringify(state.transitions))
            };
        }
        
        const activeStates = new Set();
        currentFragments.forEach(frag => {
            activeStates.add(frag.startStateId);
            activeStates.add(frag.endStateId);
        });

        this.steps.push({
            description,
            states: statesSnapshot,
            activeStates: Array.from(activeStates),
            startStateId: currentFragments.length > 0 ? currentFragments[currentFragments.length - 1].startStateId : null,
            endStateId: currentFragments.length > 0 ? currentFragments[currentFragments.length - 1].endStateId : null
        });
    }

    recordDfaStep(description, dfaStates, activeStateIds, silent = false) {
        if (silent) return;
        const statesSnapshot = {};
        for (let i = 0; i < dfaStates.length; i++) {
            const state = dfaStates[i];
            const formattedTransitions = {};
            for (const char in state.transitions) {
                formattedTransitions[char] = [state.transitions[char]];
            }
            statesSnapshot[state.id] = {
                id: state.id,
                transitions: formattedTransitions,
                isEnd: state.isEnd,
                nfaIds: state.nfaIds
            };
        }
        
        this.dfaSteps.push({
            description,
            states: statesSnapshot,
            activeStates: activeStateIds
        });
    }

    insertExplicitConcat(regex) {
        let res = "";
        for (let i = 0; i < regex.length; i++) {
            const char = regex[i];
            res += char;
            if (char === '(' || char === '+') {
                continue;
            }
            if (i < regex.length - 1) {
                const nextChar = regex[i + 1];
                if (nextChar === '*' || nextChar === '?' || nextChar === '+' || nextChar === ')') {
                    continue;
                }
                res += '.';
            }
        }
        return res;
    }

    toPostfix(regex) {
        const precedence = {
            '+': 1,
            '.': 2,
            '*': 3,
            '?': 3
        };

        const isOperator = (c) => precedence.hasOwnProperty(c);
        let postfix = "";
        const stack = [];

        for (let i = 0; i < regex.length; i++) {
            const char = regex[i];

            if (char === '(') {
                stack.push(char);
            } else if (char === ')') {
                while (stack.length > 0 && stack[stack.length - 1] !== '(') {
                    postfix += stack.pop();
                }
                stack.pop(); // Remove '('
            } else if (isOperator(char)) {
                if (char === '*' || char === '?') {
                    postfix += char;
                } else {
                    while (stack.length > 0 && stack[stack.length - 1] !== '(' && precedence[stack[stack.length - 1]] >= precedence[char]) {
                        postfix += stack.pop();
                    }
                    stack.push(char);
                }
            } else {
                postfix += char;
            }
        }

        while (stack.length > 0) {
            postfix += stack.pop();
        }

        return postfix;
    }

    buildNFA(postfix, silent = false) {
        this.reset();
        const stack = [];

        for (let i = 0; i < postfix.length; i++) {
            const char = postfix[i];

            if (char === '.') { 
                const f2 = stack.pop();
                const f1 = stack.pop();
                
                this.states.get(f1.endStateId).addTransition('ε', f2.startStateId);
                
                const newFrag = new NFAFragment(f1.startStateId, f2.endStateId);
                stack.push(newFrag);
                this.recordStep(`Concatenation: Linked end of previous to start of next.`, stack, silent);
            } 
            else if (char === '+') { 
                const f2 = stack.pop();
                const f1 = stack.pop();
                
                const start = this.newState();
                const end = this.newState();
                
                start.addTransition('ε', f1.startStateId);
                start.addTransition('ε', f2.startStateId);
                this.states.get(f1.endStateId).addTransition('ε', end.id);
                this.states.get(f2.endStateId).addTransition('ε', end.id);
                
                const newFrag = new NFAFragment(start.id, end.id);
                stack.push(newFrag);
                this.recordStep(`Union (+): Created branching path.`, stack, silent);
            } 
            else if (char === '*') { 
                const f1 = stack.pop();
                
                const start = this.newState();
                const end = this.newState();
                
                start.addTransition('ε', f1.startStateId);
                start.addTransition('ε', end.id); 
                this.states.get(f1.endStateId).addTransition('ε', f1.startStateId); 
                this.states.get(f1.endStateId).addTransition('ε', end.id); 
                
                const newFrag = new NFAFragment(start.id, end.id);
                stack.push(newFrag);
                this.recordStep(`Kleene Star (*): Added loop back and bypass for zero occurrences.`, stack, silent);
            }
            else if (char === '?') { 
                const f1 = stack.pop();
                
                const start = this.newState();
                const end = this.newState();
                
                start.addTransition('ε', f1.startStateId);
                start.addTransition('ε', end.id); 
                this.states.get(f1.endStateId).addTransition('ε', end.id); 
                
                const newFrag = new NFAFragment(start.id, end.id);
                stack.push(newFrag);
                this.recordStep(`Optional (?): Added bypass for zero occurrences.`, stack, silent);
            }
            else { 
                const start = this.newState();
                const end = this.newState();
                
                start.addTransition(char, end.id);
                
                const newFrag = new NFAFragment(start.id, end.id);
                stack.push(newFrag);
                this.recordStep(`Literal '${char}': Created transition from start to end.`, stack, silent);
            }
        }

        if (stack.length !== 1) {
            throw new Error("Invalid regular expression");
        }

        const finalFragment = stack.pop();
        this.states.get(finalFragment.endStateId).isEnd = true;
        this.recordStep(`Final NFA completed.`, [finalFragment], silent);

        return {
            startStateId: finalFragment.startStateId,
            endStateId: finalFragment.endStateId,
            states: this.states, 
            steps: this.steps
        };
    }

    compile(regexStr, silent = false, doMinimize = false) {
        if (!regexStr) return null;
        try {
            const withConcat = this.insertExplicitConcat(regexStr);
            const postfix = this.toPostfix(withConcat);
            const nfa = this.buildNFA(postfix, silent);
            const dfa = this.nfaToDfa(nfa.startStateId, nfa.endStateId, nfa.states, silent);
            if (doMinimize) {
                this.minimizeDfa(dfa, silent);
            }
            return {
                ...nfa,
                dfaSteps: this.dfaSteps,
                lastDfa: dfa
            };
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    epsilonClosure(stateIds, statesMap) {
        const closure = new Set(stateIds);
        const stack = [...stateIds];
        while (stack.length > 0) {
            const id = stack.pop();
            const state = statesMap.get(id);
            if (state && state.transitions['ε']) {
                for (const nextId of state.transitions['ε']) {
                    if (!closure.has(nextId)) {
                        closure.add(nextId);
                        stack.push(nextId);
                    }
                }
            }
        }
        return Array.from(closure).sort((a,b)=>a-b);
    }

    move(stateIds, char, statesMap) {
        const nextStates = new Set();
        for (const id of stateIds) {
            const state = statesMap.get(id);
            if (state && state.transitions[char]) {
                for (const nextId of state.transitions[char]) {
                    nextStates.add(nextId);
                }
            }
        }
        return Array.from(nextStates).sort((a,b)=>a-b);
    }

    nfaToDfa(startStateId, endStateId, statesMap, silent = false) {
        const alphabet = new Set();
        for (const state of statesMap.values()) {
            for (const char in state.transitions) {
                if (char !== 'ε') alphabet.add(char);
            }
        }

        const dfaStates = [];
        const dfaStateMap = new Map();

        const eClosureStart = this.epsilonClosure([startStateId], statesMap);
        const startStateStr = JSON.stringify(eClosureStart);
        
        let dfaCounter = 0;
        dfaStates.push({
            id: dfaCounter,
            nfaIds: eClosureStart,
            transitions: {},
            isEnd: eClosureStart.includes(endStateId)
        });
        dfaStateMap.set(startStateStr, dfaCounter);
        this.recordDfaStep(`Initialized DFA start state ${dfaCounter} from start e-closure.`, dfaStates, [dfaCounter], silent);
        dfaCounter++;

        let unassignedIdx = 0;
        while (unassignedIdx < dfaStates.length) {
            const currDfaState = dfaStates[unassignedIdx];
            
            for (const char of alphabet) {
                const moveResult = this.move(currDfaState.nfaIds, char, statesMap);
                if (moveResult.length === 0) continue;
                
                const eClosureMove = this.epsilonClosure(moveResult, statesMap);
                const newStateStr = JSON.stringify(eClosureMove);
                
                if (!dfaStateMap.has(newStateStr)) {
                    dfaStates.push({
                        id: dfaCounter,
                        nfaIds: eClosureMove,
                        transitions: {},
                        isEnd: eClosureMove.includes(endStateId)
                    });
                    dfaStateMap.set(newStateStr, dfaCounter);
                    this.recordDfaStep(`Found new state ${dfaCounter} via '${char}'.`, dfaStates, [currDfaState.id, dfaCounter], silent);
                    dfaCounter++;
                }
                
                currDfaState.transitions[char] = dfaStateMap.get(newStateStr);
                this.recordDfaStep(`Added transition: ${currDfaState.id} --${char}--> ${dfaStateMap.get(newStateStr)}`, dfaStates, [currDfaState.id], silent);
            }
            unassignedIdx++;
        }
        
        this.recordDfaStep(`DFA Subset Construction Complete.`, dfaStates, [], silent);

        return {
            startStateId: 0,
            states: dfaStates,
            alphabet: Array.from(alphabet)
        };
    }

    minimizeDfa(dfa, silent = false) {
        let partitions = [];
        const accept = [];
        const nonAccept = [];
        
        for (const state of dfa.states) {
            if (state.isEnd) accept.push(state.id);
            else nonAccept.push(state.id);
        }
        if (accept.length > 0) partitions.push(accept);
        if (nonAccept.length > 0) partitions.push(nonAccept);

        let stateToPartition = {};
        for (let i = 0; i < partitions.length; i++) {
            for (const id of partitions[i]) stateToPartition[id] = i;
        }

        let changed = true;
        while (changed) {
            changed = false;
            const newPartitions = [];

            for (const p of partitions) {
                const groups = {};
                for (const stateId of p) {
                    const state = dfa.states.find(s => s.id === stateId);
                    let sig = "";
                    for (const char of dfa.alphabet) {
                        const targetId = state.transitions[char];
                        const targetPart = targetId !== undefined ? stateToPartition[targetId] : -1;
                        sig += `${targetPart},`;
                    }
                    if (!groups[sig]) groups[sig] = [];
                    groups[sig].push(stateId);
                }

                const keys = Object.keys(groups);
                if (keys.length > 1) changed = true;
                
                for (const key of keys) {
                    newPartitions.push(groups[key]);
                }
            }
            partitions = newPartitions;
            for (let i = 0; i < partitions.length; i++) {
                for (const id of partitions[i]) stateToPartition[id] = i;
            }
        }

        const startIdx = partitions.findIndex(p => p.includes(dfa.startStateId));
        if (startIdx > 0) {
            const temp = partitions[0];
            partitions[0] = partitions[startIdx];
            partitions[startIdx] = temp;
        }

        stateToPartition = {};
        for (let i = 0; i < partitions.length; i++) {
            for (const id of partitions[i]) stateToPartition[id] = i;
        }

        const minDfaStates = [];
        const startPart = stateToPartition[dfa.startStateId];
        
        for (let i = 0; i < partitions.length; i++) {
            const p = partitions[i];
            const repId = p[0];
            const repState = dfa.states.find(s => s.id === repId);
            
            const newTransitions = {};
            for (const char of dfa.alphabet) {
                if (repState.transitions[char] !== undefined) {
                    newTransitions[char] = stateToPartition[repState.transitions[char]];
                }
            }
            
            let combinedNfaIds = [];
            for (const id of p) {
                const s = dfa.states.find(st => st.id === id);
                if (s.nfaIds) combinedNfaIds = combinedNfaIds.concat(s.nfaIds);
            }
            combinedNfaIds = Array.from(new Set(combinedNfaIds)).sort((a,b)=>a-b);

            minDfaStates.push({
                id: i,
                nfaIds: combinedNfaIds,
                transitions: newTransitions,
                isEnd: repState.isEnd,
            });
        }

        this.recordDfaStep(`Moore's Minimization Complete. Reduced to ${minDfaStates.length} states.`, minDfaStates, [], silent);

        dfa.states = minDfaStates;
        dfa.startStateId = startPart;
        return dfa;
    }

    generateStrings(startStateId, endStateId, statesMap, maxLength) {
        const dfa = this.nfaToDfa(startStateId, endStateId, statesMap, true);
        this.minimizeDfa(dfa, true);
        const results = new Set();
        const queue = [{ dfaId: dfa.startStateId, str: "" }];
        
        while (queue.length > 0) {
            const { dfaId, str } = queue.shift();
            const state = dfa.states[dfaId];
            
            if (state.isEnd) {
                results.add(str === "" ? "ε (Empty String)" : str);
            }
            
            if (str.length < maxLength) {
                for (const char in state.transitions) {
                    queue.push({ dfaId: state.transitions[char], str: str + char });
                }
            }
        }
        
        if (results.size === 0) return [];
        return Array.from(results).sort((a, b) => a.length - b.length || a.localeCompare(b));
    }

    checkEquivalence(regex1, regex2) {
        if (!regex1 || !regex2) return false;
        try {
            const n1 = this.compile(regex1, true);
            const n2 = this.compile(regex2, true);
            if (!n1 || !n2) return false;
            
            const dfa1 = this.nfaToDfa(n1.startStateId, n1.endStateId, n1.states, true);
            const dfa2 = this.nfaToDfa(n2.startStateId, n2.endStateId, n2.states, true);
            
            this.minimizeDfa(dfa1, true);
            this.minimizeDfa(dfa2, true);
            
            const combinedAlphabet = new Set([...dfa1.alphabet, ...dfa2.alphabet]);
            
            const visited = new Set();
            const queue = [{ q1: dfa1.startStateId, q2: dfa2.startStateId }];
            visited.add(`${dfa1.startStateId},${dfa2.startStateId}`);
            
            while(queue.length > 0) {
                const {q1, q2} = queue.shift();
                
                const s1 = q1 !== -1 ? dfa1.states[q1] : null;
                const s2 = q2 !== -1 ? dfa2.states[q2] : null;
                
                const acc1 = s1 ? s1.isEnd : false;
                const acc2 = s2 ? s2.isEnd : false;
                
                if (acc1 !== acc2) return false;
                
                for (const char of combinedAlphabet) {
                    const next1 = (s1 && s1.transitions[char] !== undefined) ? s1.transitions[char] : -1;
                    const next2 = (s2 && s2.transitions[char] !== undefined) ? s2.transitions[char] : -1;
                    
                    if (next1 === -1 && next2 === -1) continue;
                    
                    const stateKey = `${next1},${next2}`;
                    if (!visited.has(stateKey)) {
                        visited.add(stateKey);
                        queue.push({q1: next1, q2: next2});
                    }
                }
            }
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }
    }
}
