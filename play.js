const fs      = require('fs')
const ps      = require('./ps.js')
const utils   = require('./utils.js')
const nearai  = require('./nearai.js')

const sleep = (millis) => new Promise(resolve => setTimeout(resolve, millis))
const common_timeout = process.env.TIMEOUT ? +process.env.TIMEOUT : 180
const reverse = {'0':'X','X':'0'}

log = (text, log_id) => {
	fs.appendFile('logs/'+log_id+'.log', text+'\n', (err)=>{if (err) console.log(err)})
}
modify_prompt	= (prompt, game_data={}) => {
	for (const key of Object.keys(game_data))
		prompt = prompt.replace('${'+key+'}', typeof game_data[key] == 'string' ? game_data[key] : JSON.stringify(game_data[key])) 
	return prompt.replace(/\$\{.+?\}/g,'')
}
extract_turns	= (text) => {
	const turns = text.match(/[a-h][1-8]/gi)
	return turns?turns.pop().toLowerCase():null
}
async function get_turn_ext(agent_data, turns_list, game){
	if (agent_data.path.split('/').length==2) agent_data.path+='/latest'
	const now = Date.now(), timeout = (agent_data.timeout || common_timeout)*1000
	const payload = JSON.stringify({player:game.current, turns_list, board:utils.text_board(game.board), raw:game.board})
	for (let k=0; k<5; k++){
		try{
			if (k>1 && game.game[game.current].thread_id){
				const res = await nearai.get_thread(game.game[game.current].thread_id) 	
				if (res?.detail == 'Thread not found'){
					log(game.game[game.current].thread_id+' not found.')
					delete game.game[game.current].thread_id
				}
			}
			if (!game.game[game.current].thread_id){
				if (await ps.check_flood('thread_time.'+game.id+'-'+game.game[game.current].id, 60)) throw Error('spam protection of create thread for '+game.id+'-'+game.game[game.current].id)
				game.game[game.current].thread_id = await nearai.create_thread(agent_data.path, payload, timeout)
				ps.update_game(game.key, {game:game.game})
				log((k+1)+'.create_thread '+game.game[game.current].thread_id)
			} 
			else await nearai.send_message(agent_data.path, game.game[game.current].thread_id, payload, timeout)

			let answers	= []
			for (let i=0; i<(agent_data.timeout); i++){
				answers = await nearai.get_answers(game.game[game.current].thread_id)
				if (answers?.length || (Date.now()-now > timeout)) break
				await sleep(1000)
			}
			if (!answers) continue
			const moves = answers.map(m => extract_turns(m)).filter(e => e)
			if (moves.length){
				let turn = moves[0]
				const possible_moves = moves.filter(e => turns_list.includes(e))
				if (possible_moves.length){
					turn = possible_moves[Math.trunc(Math.random()*possible_moves.length)]
					if (k) log('attempt #'+(k+1)+'\n'+answers.find(e => e.indexOf(turn)>0)+'\nturns_list '+JSON.stringify(turns_list)+'\nturn '+turn+'\n', game.id)
					return {...game, turn}
				}
				log('player '+game.current+', attempt #'+(k+1)+'\n'+answers.find(e => e.indexOf(turn)>0)+'\nturns_list '+JSON.stringify(turns_list)+'\nturn '+turn+' is not allowed\n', game.id)
			}
		}catch(err){
			console.log(err)
		}
	}
	return game
}
async function get_turn_local(agent_data, turns_list, game){
	const corners = [[[7,0],[0,0],[7,7],[0,7]],['a1','a8','h1','h8'],['b2','b7','g2','g7'],[]];
	const intersection = turns_list.filter(x => corners[1].includes(x));
	if (intersection.length) return {...game, turn:intersection[Math.trunc(Math.random()*intersection.length)]}
	for (let i=0; i<4; i++)
		if (game.board[corners[0][i][0]][corners[0][i][1]] == '.') corners[3].push(corners[2][i])
	const difference = turns_list.filter(x => !corners[2].includes(x));
	if (difference.length && difference.length < turns_list.length){
		if (difference.length<2) return {...game, turn:difference[0]}
		turns_list = difference
	}
	if (agent_data.id == 'random') return {...game, turn:turns_list[Math.trunc(Math.random()*turns_list.length)]}

	const now = Date.now(), timeout = (agent_data.timeout || common_timeout)*1000
	const prompt = modify_prompt(agent_data.prompt, {turns_list, player:game.current, board:utils.text_board(game.board)})
	for (let k=0; k<5; k++){
		try{
			const completion = await nearai.request('chat/completions','POST',{model:agent_data.model, temperature:agent_data.temperature, max_tokens:agent_data.max_tokens, messages:[{"role":"system", "content":prompt}]}, timeout)
			const message = completion.choices[0].message.content
			const turn  = extract_turns(message)
			if (turns_list.includes(turn)){
				if (k) log('attempt #'+(k+1)+'\n'+message+'\nturns_list '+JSON.stringify(turns_list)+'\nturn '+turn+'\n', game.id)
				return {...game, turn}
			}
			log('player '+game.current+', attempt #'+(k+1)+'\n'+message+'\nturns_list '+JSON.stringify(turns_list)+'\nturn '+turn+' is not allowed\n', game.id)
		}catch(err){
			console.log(err)
		}
		if (Date.now()-now > timeout) break
	}	
	return game
}
async function close_game(game, failed){
	for (const thread of Object.values(game.game)) 
		if (thread.thread_id) nearai.delete_thread(thread.thread_id)
		
	game.closed = Date.now()
	if (!game.winner){
		game.winner = '-'
		game.scores = utils.scores(game.board)
		if (game.scores['0']>game.scores['X']) game.winner = '0'
		if (game.scores['X']>game.scores['0']) game.winner = 'X'
	}
	if (failed){
		game.scores = {'0':0, 'X':0}
	}
	ps.del_log_size(game.id)
	const message = failed ? '#'+game.count+'. player '+game.current+' was unable to formulate his turn. The game is interrupted.\n' : 'game over'
	log(message+'\nwinner: '+game.winner+'\ngame closed at '+new Date(game.closed).toISOString().substr(0,16).replace('T',', ')+'\ngame time: '+Math.round((game.closed-game.date)/1000)+'s\nspent 0: '+Math.round(game.game['0'].spent/1000)+'s, spent X: '+Math.round(game.game['X'].spent/1000)+'s', game.id)
	if (game.id.startsWith('human-')){
		if (!failed){
			const agent = Object.values(game.game).find(e => !e.id.startsWith('human-'))
			if (agent){
				try{
					const agent_data = await ps.get_agent_data(agent.id)
					if (!agent_data.availability) log('Agent '+(agent_data.name || agent_data.id)+' is marked as active.', game.id)
					ps.set_availability(agent.id, 1)
				}catch(err){
					console.log(err)
				}
			}	
		}
		game.current = reverse[game.current]
		return ps.update_game(game.key, game)
	}	
	return ps.archive_game(game, failed)
}
async function make_move(game){
	try{
		const res = await ps.set_busy(game.key)
		if (res?.err) throw Error('error setting busy flag')
			
		const turns_list = utils.turns(game.board)
		if (!turns_list['0'].length && !turns_list['X'].length) return close_game(game) 
		const agent_data = await ps.get_agent_data(game.game[game.current].id)
		if (!agent_data || agent_data.err) return console.log(!agent_data?'No agent data found':agent_data.err) 

		if (turns_list[game.current].length){
			game.count++
			let d = Date.now() 
			if (turns_list[game.current].length>1){
				delete game.turn
				if (agent_data.path)   game = await get_turn_ext(agent_data, turns_list[game.current], game)
				if (agent_data.prompt) game = await get_turn_local(agent_data, turns_list[game.current], game)
				if (Date.now()-d > (agent_data.timeout || common_timeout)*1000) return log('#'+game.count+'. player '+game.current+', timeout:'+((Date.now()-d)/1000)+'('+(agent_data.timeout || common_timeout)+'), exit without results. id:'+game.id+'\n', game.id)	
				if (!game.turn) return close_game({...game, winner:reverse[game.current], scores:utils.scores(game.board)}, 1) 
			} else game.turn = turns_list[game.current][0]
			const time = Date.now() - d
			game.game[game.current].spent+=time
			game.board = utils.fill(game.board, 8-(+game.turn.substr(1,1)), game.turn.charCodeAt(0)-97, game.current)

			log('#'+game.count+'. player '+game.current+': '+game.turn+' ('+agent_data.name+', '+time/1000+'s, game:'+game.id+')\n'+utils.text_board(game.board,1)+'\n'+JSON.stringify(utils.scores(game.board))+'\n', game.id)
		} else log('player '+game.current+' skips his turn\n', game.id)

		game.current = reverse[game.current]
		if (game.id.startsWith('human-')){
			const turns_list = utils.turns(game.board)
			game.human_moves = turns_list[game.current]
			if (!game.human_moves.length){
				if (turns_list[reverse[game.current]].length) log('human player '+game.current+' skips his turn\n', game.id)
				game.current = reverse[game.current]
			}
		}
		game.busy = 0
		return ps.update_game(game.key, game) 
	}catch(err){
		console.log(err)
	}
}
async function create_game(param1, param2){
	const parameters = [...arguments]
	let agents_data, pair_id
	if (parameters.length>1){
		agents_data = await Promise.all(parameters.map(ps.get_agent_data))
		pair_id = await ps.get_pair(parameters[0], parameters[1])
		if (!pair_id || pair_id.err) return {err: 'error creating agent pair'}
	} else {
		let agents = await ps.get_by_pair(parameters[0])
		if (!agents) throw Error('agents pair not found')
		agents = agents.split('.')
		agents_data = await Promise.all(agents.map(ps.get_agent_data))
		pair_id = parameters[0]
	}
		
	let game = await ps.get_game(pair_id)
	if (game) return {err: game.err || 'game is already on'}
	const rnd = Math.round(Math.random())
	const date = Date.now()
	game = {
		id: pair_id+'.'+date,
		date,
		count: 0,
		board: [
			['.','.','.','.','.','.','.','.'],
			['.','.','.','.','.','.','.','.'],
			['.','.','.','.','.','.','.','.'],
			['.','.','.','0','X','.','.','.'],
			['.','.','.','X','0','.','.','.'],
			['.','.','.','.','.','.','.','.'],
			['.','.','.','.','.','.','.','.'],
			['.','.','.','.','.','.','.','.']],
		current: 'X',
		game: {
			'0': {
				id: agents_data[rnd].id,
				path: agents_data[rnd].path,
				spent:0
			},
			'X': {
				id: agents_data[1-rnd].id,
				path: agents_data[1-rnd].path,
				spent:0
			}
		}
	}
	log('Game created at '+new Date(game.date).toISOString().substr(0,16).replace('T',', ')+'\nPlayer #1(0): '+agents_data[rnd].name+'. '+agents_data[rnd].description+'\nPlayer #2(X): '+agents_data[1-rnd].name+'. '+agents_data[1-rnd].description+'\n', game.id)
	await ps.update_game(pair_id, game, 1)
}
async function create_human_game(game){
	await ps.del_log_size(game.id)
	const agent_id = game.game[game.current].id
	if (agent_id.startsWith('human-')) return {error:'{error:"now it is human turn"}'}
	const agent_data = await ps.get_agent_data(agent_id)
	game.game[game.current].path = agent_data.path
	fs.writeFileSync('logs/'+game.id+'.log','#'+game.count+'. human '+reverse[game.current]+': '+game.turn+'\n'+utils.text_board(game.board,1)+'\n'+JSON.stringify(utils.scores(game.board))+'\n\n',(err)=>{console.log(err)})
	await ps.update_game(game.id, game, 1)
}

setInterval(() => ps.get_games(1).then(games => games.forEach(make_move)).catch(console.error), 1000)

module.exports = {create_game, create_human_game}
