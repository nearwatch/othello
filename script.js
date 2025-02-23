const reverse = {'0':'X','X':'0'}
const flags   = {}
const addressValid = (address) => /^([a-z0-9][a-z0-9\.\-\_]{1,61}\.(near|tg))$/i.test(address) || /^[0-9a-f]{64}$/i.test(address); 	

const user_id = window.localStorage.getItem('user_id') || 'human-'+self.crypto.randomUUID()
window.localStorage.setItem('user_id', user_id)
document.getElementById('near_address').value = window.localStorage.getItem('near_address')

async function agent_search(){
    const search_results = document.getElementById('search-result');
    const search_text = document.getElementById('search_input').value;
    if (!search_text.length) return search_results.innerHTML = '';
    let search_result = '<div class="no_agent">No agent found</div>'
    const res = await window.fetch('agents/'+search_text); 
    if (res.ok){
        const agents = await res.json();
        if (agents.length)
            search_result = agents.map(agent => `
                <div class="search-row" onclick="agent_card('${agent.id}');">
                <div class="player-name">${agent.name}</div>
                <div class="player-description">${agent.desc}</div>
                </div>
            `).join('');
    }	
    search_results.innerHTML = search_result
}
function save_near_account(){
    near_address = document.getElementById('near_address').value;
    window.localStorage.setItem('near_address', near_address);
}
async function loadLeaderboard() {
    const res = await window.fetch('scores'); 
    if (res.ok){
        const players = await res.json()
        const leaderboard = document.getElementById('leaderboard');
        leaderboard.innerHTML = players.map(player => `
            <div class="player-row" onclick="agent_card('${player.id}');">
            <div class="player-name">${player.pos}. ${player.name}</div>
            <div class="player-score">${player.pc}</div>
            </div>
        `).join('');
    } else console.error(res.statusText)
}
async function home(){
    loadLeaderboard();
    select_page('home')
}
async function game_card(id, agent_id){
    flags.game = null
    const res = await window.fetch('archive/'+id); 
    if (res.ok){
        const data = await res.json()
        document.getElementById('pair_log').innerHTML = data.log_text || ''
        fill_board(data.board, agent_id != data.game[0].id)
    } 
}
async function get_game(pair_id, agent_id, forced){
    try{
        const res = await window.fetch('game/'+pair_id+(forced?'?forced=1':'')); 
        if (res.ok) {
            const data = await res.json()
            if (data.no_changes) return data
            if (data.log_text){
                const textarea = document.getElementById('pair_log')
                textarea.innerHTML = data.log_text
                textarea.scrollTop = textarea.scrollHeight;
            }	
            create_board();
            fill_board(data.board, agent_id != data.game[0].id, data.current)			
            flags.game = {pair_id, agent_id}
            return data
        }
    }catch(err){}
  
    if (flags.game){ 
        flags.game = null
        pair_card(agent_id+'.'+pair_id)
    }
}
async function get_human_game(id, forced){
    try{
        const res = await window.fetch('game/'+id+(forced?'?forced=1':'')); 
        if (res.ok) {
            const x = await res.json()
            if (x.no_changes || !x.game[x.current].id.startsWith('human-')) return x
            if (x.log_text){
                const textarea = document.getElementById('game_log')
                textarea.innerHTML +='\n'+x.log_text
                textarea.scrollTop = textarea.scrollHeight;
            }	
            delete flags.human_game;
            window.localStorage.setItem('game', JSON.stringify(x));
            create_board('2');
            fill_board(x.board, x.game['0'].id.startsWith('human-'), x.current, x.human_moves, '2', x.winner);
            if (!x.winner) return 
            window.fetch('game/'+id, {method:'DELETE'}); 
            if (document.getElementById('pending')){
                const agent = Object.values(x.game).find(e => !e.id.startsWith('human-'));
                if (agent){
                    const res = await window.fetch('agent/'+agent.id); 
                    if (res.ok){
                        const data = await res.json();
                        if (data.availability) {
                            delete flags.human_game;
                            return agent_card(agent.id)
                        }
                    }	
                }	
            }
        }
    }catch(err){
        console.log(err)
    }
    delete flags.human_game;
}
async function play_pair(){
    try{
        if (flags.agent_pair){
            const pair_id = flags.agent_pair.split('.').pop()
            await window.fetch('pair/'+pair_id,{method:'POST'}); 
        }
    }catch(err){
        console.error(err)
    }
    return pair_card(flags.agent_pair)
}
async function pair_card(agent_pair){
    const res = await window.fetch('pair/'+agent_pair); 
    if (res.ok){
        const data = await res.json();
        const pending = data.agents.map(e => !e.availability)
        flags.agent_pair = agent_pair;
        document.getElementById('pairData').innerHTML = `
            <div class="pair-agents-data" onclick="agent_card('${data.agents[0].id}');">
                <div class="pair-agent-scores">${data.scores[0]}</div><div class="agent-name">${data.agents[0].name}</div>${pending[0]?'<div class="pending">PENDING</div>':''}
            </div>
            <div class="pair-agents-data" onclick="agent_card('${data.agents[1].id}');">
                <div class="pair-agent-scores">${data.scores[1]}</div><div class="agent-name">${data.agents[1].name}</div>${pending[1]?'<div class="pending">PENDING</div>':''}
            </div>
        `
        document.getElementById('pair_play_button').disabled = pending[0] || pending[1];
        document.getElementById('pair_history').innerHTML = '<div class="agent-descr" style="margin-bottom:16px;">HISTORY</div>'+data.history.map(game => `
            <div class="player-row" onclick="game_card('${data.pair_id}.${game.date}','${data.agents[0].id}');">
                <div class="player-score">${game.scores}</div>
                <div class="game-data">${new Date(game.closed).toLocaleString()}</div>
            </div>
        `).join('');
        create_board();
        const game_now = await get_game(data.pair_id, data.agents[0].id, 1)
        if (!game_now && data.history.length) await game_card(data.pair_id+'.'+data.history[0].date, data.agents[0].id)
        select_page('pair','pair_history') 
    } else console.error(res.statusText)
}
function create_board(postfix=''){
    const BOARD_OFFSET_X = 60; 
    const BOARD_OFFSET_Y = 0; 
    document.getElementById('board-container'+postfix).innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 600 600">
            <defs>
                <linearGradient id="lightWood${postfix}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#D7CCC8"/>
                    <stop offset="50%" style="stop-color:#BCAAA4"/>
                    <stop offset="100%" style="stop-color:#A1887F"/>
                </linearGradient>
            </defs>
            <rect x="60" y="0" width="480" height="480" fill="url(#lightWood${postfix})"/>
            <g id="board${postfix}"></g>
            <g id="coordinates${postfix}"></g>
            <g id="scores${postfix}"></g>
            <g id="pieces${postfix}"></g>
        </svg>
	  `
    const boardElement = document.getElementById('board'+postfix);
    const coordinatesElement = document.getElementById('coordinates'+postfix);
    const board = Array(8).fill().map(() => Array(8).fill(null));
            
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            cell.setAttribute('x', col*60+BOARD_OFFSET_X);
            cell.setAttribute('y', row*60+BOARD_OFFSET_Y);
            cell.setAttribute('width', 60);
            cell.setAttribute('height', 60);
            cell.setAttribute('fill', 'transparent');
            cell.setAttribute('stroke', '#5D4037');
            cell.setAttribute('stroke-width', '1');
            cell.setAttribute('class', 'cell');
            cell.dataset.row = row;
            cell.dataset.col = col;
            boardElement.appendChild(cell);
        }
    }
    for (let col = 0; col < 8; col++) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', col * 60 + BOARD_OFFSET_X + 60/2);
        text.setAttribute('y', 8 * 60 + BOARD_OFFSET_Y + 25);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'coordinate-text');
        text.textContent = String.fromCharCode(97 + col);
        coordinatesElement.appendChild(text);
    }
    for (let row = 0; row < 8; row++) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', BOARD_OFFSET_X - 20);
        text.setAttribute('y', (8 - 1 - row) * 60 + BOARD_OFFSET_Y + 60/2 + 7);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'coordinate-text');
        text.textContent = row + 1;
        coordinatesElement.appendChild(text);
    }
}
function fill_board(board_in, rotate, current, moves=[], postfix='', winner){
    moves = moves.map(e => [8-(+e[1]), e.charCodeAt(0)-97]); 
    const results = [0,0];
    for (let i=0; i<8; i++){
        for (let j=0; j<8; j++){
            if (moves.find(e => e[0]==i && e[1]==j)) placeMove(i,j)
            if (board_in[i][j] == '0'){
                results[0]++
                placePiece(i, j, 'white');
            }
            if (board_in[i][j] == 'X'){
                results[1]++
                placePiece(i, j, 'black');
            }	
        }
    }
    let live = ''
    if (current){
        const rotate_flag = (rotate && current == '0') || (!rotate && current == 'X')
        const live_text = winner ? 'WIN' : (postfix.length?(rotate_flag?'YOU':'LIVE'):'LIVE')
        const pos = winner ? ((rotate && winner == '0') || (!rotate && winner == 'X')?400:0) : (rotate_flag?400:0)
        if (winner!='-')
            live = `
                <rect x="${60+pos}" y="540" width="80" height="40" fill="red"></rect>
                <text x="${100+pos}" y="571" text-anchor="middle" class="piece white">${live_text}</text>
            `
    }
    const scores = document.getElementById('scores'+postfix);
    scores.innerHTML = `
        <circle cx="260" cy="560" r="28" class="piece ${rotate?'black':'white'}"></circle>
        <text x="260" y="571" text-anchor="middle" class="piece ${rotate?'white':'black'}">${results[rotate?1:0]}</text>
        <circle cx="340" cy="560" r="28" class="piece ${rotate?'white':'black'}"></circle>
        <text x="340" y="571" text-anchor="middle" class="piece ${rotate?'black':'white'}">${results[rotate?0:1]}</text>
    `+live

    function placeMove(row, col) {
        const BOARD_OFFSET_X = 60; 
        const BOARD_OFFSET_Y = 0; 
        const piecesContainer = document.getElementById('pieces'+postfix);
        const piece  = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', col*60+BOARD_OFFSET_X);
        rect.setAttribute('y', row*60+BOARD_OFFSET_Y);
        rect.setAttribute('width', 60);
        rect.setAttribute('height', 60);
        rect.setAttribute('class', `move-rect`);
        rect.move = [row, col];
        if (postfix.length) rect.addEventListener('click', handleCellClick);
        piece.appendChild(rect);
        piecesContainer.appendChild(piece);
    }
    function placePiece(row, col, color) {
        const BOARD_OFFSET_X = 60; 
        const BOARD_OFFSET_Y = 0; 
        const piecesContainer = document.getElementById('pieces'+postfix);
        const piece  = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', col*60+BOARD_OFFSET_X+60/2);
        circle.setAttribute('cy', row*60+BOARD_OFFSET_Y+60/2);
        circle.setAttribute('r', 60*0.4);
        circle.setAttribute('class', `piece ${color}`);
        if (color === 'white') circle.setAttribute('filter', 'drop-shadow(2px 2px 2px rgba(0,0,0,0.3))');
        else circle.setAttribute('filter', 'drop-shadow(2px 2px 2px rgba(0,0,0,0.5))');
        piece.appendChild(circle);
        piecesContainer.appendChild(piece);
    }
}
async function handleCellClick(event) {
    function allow(board,i,j){
        const res = {'0':[],'X':[]}
        if (board[i][j]!='.') return res
        for (let i0=i-1; i0<i+2; i0=i0+1){
            if (i0<0 || i0>7) continue
            for (let j0=j-1; j0<j+2; j0=j0+1 ){
                if (j0<0 || j0>7 || (i==i0 && j==j0)) continue
                if (board[i0][j0]=='X') res['0'].push([i0,j0])
                if (board[i0][j0]=='0') res['X'].push([i0,j0])
            }
        }
        for (const key of Object.keys(res)){
            res[key] = res[key].filter(cell => {
                const delta = [cell[0]-i,cell[1]-j]
                while (/^[0-7]$/.test(cell[0]) && /^[0-7]$/.test(cell[1]) && board[cell[0]][cell[1]] == reverse[key]){
                    cell[0] += delta[0]
                    cell[1] += delta[1]
                }
                return /^[0-7]$/.test(cell[0]) && /^[0-7]$/.test(cell[1]) && board[cell[0]][cell[1]] == key
            })
        }
        return res
    }
    function fill_move(board,i,j,token){
        const allows = allow(board,i,j)
        const deltas = []
        for (const x of allows[token]) deltas.push([x[0]-i,x[1]-j])
        board[i][j]	= token
        for (const d of deltas){
            for (let p=0; p<2; p++)
                if (d[p]) d[p] = d[p]/Math.abs(d[p])
            let i0=i+d[0], j0=j+d[1]		
            while (board[i0][j0]==reverse[token]){
                board[i0][j0]=token
                i0+=d[0]
                j0+=d[1]		
            }
        }
        return board
    }
	
    const move = event.currentTarget.move
    const x = JSON.parse(window.localStorage.getItem('game'));
    fill_move(x.board, move[0], move[1], x.current);
    x.turn = String.fromCharCode(97 + move[1])+(8-move[0])
    x.current = reverse[x.current];
    x.count++;
    x.human_moves = [];
    try{
        const res = await window.fetch('game/'+x.id,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(x)}); 
        if (!res.ok) return alert('Server error while retrieving game data') 
    }catch(err){
        return alert('Server error while retrieving game data') 
    }
    flags.human_game = {id:x.id};
    window.localStorage.setItem('game', JSON.stringify(x));
    create_board('2');
    fill_board(x.board, x.game['0'].id.startsWith('human-'), x.current, [], '2');
}
async function agent_card(agent_id){
    const res = await window.fetch('agent/'+agent_id); 
    if (res.ok){
        const data = await res.json()
        document.getElementById('agentData').innerHTML = `
            <div class="pair-agents-data" onclick="agent_card('${agent_id}');">
                <div class="agent-name">${data.name}</div>${!data.availability?'<div id="pending" class="pending">PENDING</div>':''}
            </div>	
            <div class="agent-descr">${data.description}</div>
            <div class="agent-stats">wins ${data.result[0]} of ${data.result[0]+data.result[1]} (${data.pc || 0}%)</div>
        `
        document.getElementById('human_buttons').innerHTML = `
            <button onclick="select_page('agent','agent_stat');">STAT</button>
            <button onclick="agent_test_init('${agent_id}')">PLAY</button>
            <button onclick="select_page('agent','agent_donate');">DONATE</button>
            <button onclick="home();">HOME</button>
        `
        document.getElementById('donation_grid').innerHTML = [0.1,0.3,0.5,1.0,1.5,2.0,2.5,3.5,5.0,10,15,20,30,50,100].map(amount => `<button onclick="handleDonation('${amount*10}','${data.owner || 'johnnydoe.near'}')">${amount} Ⓝ</button>`).join('');
        if (data.availability)
            document.getElementById('agent_stat').innerHTML = '<div class="agent-descr" style="margin-bottom:16px;">STATISTIC</div>'+data.opponents.map(player => `
                <div class="player-row" onclick="pair_card('${data.id}.${player.pair_id}');">
                    <div class="player-score">${player.res_text}</div>
                    <div class="player-name">${player.name}</div>
                </div>
            `).join('')
        else document.getElementById('agent_stat').innerHTML = 'The agent is currently in the pending status and cannot participate in competitions. You have to play at least one match with the agent until the game end. Click the "Play" button to start';	
        select_page('agent','agent_stat');
    } else console.error(res.statusText);
}
async function agent_test_init(agent_id){
    select_page('agent','agent_test');
    if (flags.human_game) return
    const x = {
        id: user_id+'.'+agent_id, 
        date: Date.now(),
        count: 0,
        board: [['.','.','.','.','.','.','.','.'],['.','.','.','.','.','.','.','.'],['.','.','.','.','.','.','.','.'],['.','.','.','0','X','.','.','.'],['.','.','.','X','0','.','.','.'],['.','.','.','.','.','.','.','.'],['.','.','.','.','.','.','.','.'],['.','.','.','.','.','.','.','.']],
        agent_id,
        current: 'X',
        game: {
            '0': {id:agent_id, spent:0},
            'X': {id:user_id, spent:0}
        },
        human_moves: ['d6','c5','e3','f4']
    }					
    if (Math.round(Math.random())) x.game = {'0':x.game['X'], 'X':x.game['0']}
    if (x.game[x.current].id == agent_id){
        switch (Math.round(Math.random()*4 + 0.5)){
            case 1:
                x.board[2][3] = 'X'
                x.board[3][3] = 'X'
                x.human_moves = ['c4','c6','e6']
                break
            case 2:
                x.board[4][4] = 'X'
                x.board[5][4] = 'X'
                x.human_moves = ['d3','f3','f5']
                break
            case 3:
                x.board[3][2] = 'X'
                x.board[3][3] = 'X'
                x.human_moves = ['c4','c6','e6']
                break
            default:
                x.board[4][4] = 'X'
                x.board[4][5] = 'X'
                x.human_moves = ['d3','f3','f5']
        }
        x.current = reverse[x.current]
        x.count++
    }
    window.localStorage.setItem('game', JSON.stringify(x))
    create_board('2');
    fill_board(x.board, x.game['X'].id == agent_id, x.current, x.human_moves, '2');
    document.getElementById('game_log').innerHTML = '';
}
async function handleDonation(amount, receiver_id) {
    const wallet = window.localStorage.getItem('near_address')
    if (!addressValid(wallet)) return alert('Incorrect sender wallet')
    if (!confirm('Are you sure to donate '+(amount/10)+'Ⓝ?')) return
    amount + '00000000000000000000000'
    try{
        const keypair 	= nearApi.utils.KeyPair.fromRandom('ed25519');
        const provider 	= new nearApi.providers.JsonRpcProvider({url:'https://rpc.mainnet.near.org'});
        const block 	= await provider.block({finality:'final'});
        const txs 		= [nearApi.transactions.createTransaction(wallet, keypair.publicKey, receiver_id, 1, [nearApi.transactions.transfer(amount)], nearApi.utils.serialize.base_decode(block.header.hash))];
        const newUrl 	= new URL('sign','https://app.mynearwallet.com/');
        newUrl.searchParams.set('transactions', txs.map(transaction => nearApi.utils.serialize.serialize(nearApi.transactions.SCHEMA, transaction)).map(serialized => Buffer.from(serialized).toString('base64')).join(','))
        window.open(newUrl.href);
    }catch(err){
        console.log(err)
    }
}
async function tools(){
    document.getElementById('tools_fields').innerHTML = '';
    const e = document.getElementById('search_nearai');
    e.value = '';
    setTimeout(function () {e.focus();}, 1);
    select_page('tools')
}
async function save_tools(pending){
    const sanitizeHTML = (str) => str.replace(/[^\w. ]/gi, (c) => '<>[]{}$'.includes(c)?'&#'+c.charCodeAt(0)+';':c);
    try{
        const data = {
            path: sanitizeHTML(document.getElementById('search_nearai').value.trim().substr(0,150)),
            name: sanitizeHTML(document.getElementById('tools_name').value.trim().substr(0,30)),
            description: sanitizeHTML(document.getElementById('tools_description').value.substr(0,100)),
            timeout: sanitizeHTML(document.getElementById('tools_timeout').value),
            pin: sanitizeHTML(document.getElementById('tools_pin').value.trim().substr(0,50)),
            pending
        }
        if (!data.path.length || data.path.split('/').length!=2) return alert('Wrong format of near.ai ID')
        if (!data.name.length) return alert('Wrong name of agent')
        if (!data.pin.length) return alert('You must enter a PIN code')
        data.timeout = (/^\d{1,3}$/.test(data?.timeout) ? +data.timeout : 120) || 120;
		
        const res = await window.fetch('agent', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); 
        const agent_data = await res.json(); 
        if (!res.ok || agent_data.error) return alert(agent_data.error || 'Error saving agent data');
        if (agent_data.id) return agent_card(agent_data.id)
    }catch(err){
        console.error(err);
        alert('Error saving agent data');
    }
}
async function nearai_search(){
    const search_nearai = document.getElementById('search_nearai');
    const tools_fields  = document.getElementById('tools_fields');
    const search_text = search_nearai.value;
    if (!search_text.length) return
    const search_arr  = search_text.split('/');
    if (!(search_arr.length == 2 && addressValid(search_arr[0]) && search_arr[1].length)){
        tools_fields.innerHTML = '';
        return search_nearai.style.color = 'red'
    }
    const res = await window.fetch('path/'+search_text); 
    const data = await res.json();
    if (!res.ok) {
        const res2 = await window.fetch('agents', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({owner_id:search_arr[0], name:search_arr[1]})}); 
        if (!res2.ok){
            tools_fields.innerHTML = '';
            return search_nearai.style.color = 'red';
        }
    }
    search_nearai.style.color = 'white';
    tools_fields.innerHTML = `
        <div class="search-container">
            <div class="tools-text">PIN code</div>
            <input id="tools_pin" type="password" class="search-input" value="" maxlength="50" tabindex="2"/>
        </div>
        <div class="search-container">
            <div class="tools-text">name</div>
            <input id="tools_name" type="text" class="search-input" value="${data.name || search_arr[1]}" maxlength="30" />
        </div>
        <div class="search-container">
            <div class="tools-text">description</div>
            <input id="tools_description" type="text" class="search-input" value="${data.description || ''}" maxlength="100"/>
        </div>
        <div class="search-container">
            <div class="tools-text">timeout</div>
            <input id="tools_timeout" type="text" class="search-input" value="${data.timeout || 120}" maxlength="3"/>
        </div>
        <div class="search-container">
              <div class="tools-text">status</div>
              <input id="tools_status" type="text" class="search-input" value="${data.availability?'ACTIVE':'PENDING'}" readonly />
        </div>
        <div class="tools-buttons">
            <button onclick="save_tools(1)">SET PENDING</button>
            <button onclick="save_tools()">SAVE</button>
            <button onclick="home()">HOME</button>
        </div>
    `;
}

function select_page(page,subpage){
    if (page!='pair') flags.game = null
    if (subpage!='agent_test') flags.test_page = null
    const pages = ['home','agent','pair','tools'];
    const subpages = {agent:['agent_stat','agent_donate','agent_test'], pair:['pair_history','pair_logs']};
    if (subpage && subpages[page]?.length)
        for (const p of subpages[page]) 
            document.getElementById(p).style.display = p == subpage?'':'none';
    for (const p of pages) document.getElementById(p).style.display = p == page?'':'none';
    document.getElementById('menuOverlay').style.display = 'none';
}
function toggleMenu() {
    history.pushState(null, null, '');
    document.getElementById('search-result').innerHTML = '';
    const e = document.getElementById('search_input');
    e.value = '';
    setTimeout(function () {e.focus();}, 1);
    const menuOverlay = document.getElementById('menuOverlay');
    const currentDisplay = menuOverlay.style.display;
    if (document.getElementById('tools').style.display=='' && currentDisplay=='none') return home()
    menuOverlay.style.display = currentDisplay === 'none' ? 'block' : 'none';
}
document.addEventListener('click', function(event) {
    const menuOverlay = document.getElementById('menuOverlay');
    const menuButton = document.querySelector('.menu-button');
    if (!event.target.closest('.menu-content') && !event.target.closest('.menu-button') && menuOverlay.style.display === 'block') menuOverlay.style.display = 'none';
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const isNotCombinedKey = !(event.ctrlKey || event.altKey || event.shiftKey);
        if (isNotCombinedKey) toggleMenu()
    }
});
document.addEventListener('touchstart', function(event) {if (event.touches.length > 1) event.preventDefault();}, {passive:false});
document.addEventListener('DOMContentLoaded', () => {
    loadLeaderboard();
    history.pushState('othello', null, null);
    window.onpopstate = function() {
        history.pushState('homeothello', null, null);
        home();
    };
});
setInterval(() => {
    if (flags.game) get_game(flags.game.pair_id, flags.game.agent_id)
    if (flags.human_game) get_human_game(flags.human_game.id)
},1000)
