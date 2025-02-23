const fs      = require('fs')
const dotenv  = require('dotenv').config()
const polka   = require('polka')
const parseUrl= require('@polka/url')
const bparser = require('body-parser')
const play    = require('./play.js')
const nearai  = require('./nearai.js')
const utils   = require('./utils.js')
const ps      = require('./ps.js')

const addressValid = (address) => /^([a-z0-9][a-z0-9\.\-\_]{1,61}\.(near|tg))$/i.test(address) || /^[0-9a-f]{64}$/i.test(address); 	
const web_fs  = {}
for (const key of ['script.js','styles.css','index.html','othello.jpg','favicon.ico']) 
	web_fs[key] = fs.readFileSync(key)

const debug_s = {} // {'Access-Control-Allow-Origin':'*'} 

const server = polka() 
server.use(bparser.json(), (req,res,next) => {
	try{
		const contents = {html:'text/html; charset=utf-8', js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', jpg:'image/jpeg', ico:'image/x-icon'}
		const fn = req.path.length>1 ? req.path.substr(1) : 'index.html'
		const ext = fn.split('.').pop()
		if (web_fs[fn]){
			if (contents[ext]) res.writeHead(200,{'Content-Type':contents[ext], ...debug_s})
			return res.end(web_fs[fn])
		}
		return next()
	}catch(err){
		console.log(err)
		res.writeHead(400,{...debug_s})
		res.end('Something went wrong')
	}
})
server.get('/scores',async (req,res) => {
	try{
		const agents = await ps.get_agents()
		let scores = await ps.get_scores()
		scores = scores.filter(e => agents[e.id] && agents[e.id].availability).map(e => ({...e, name:agents[e.id].name, description:agents[e.id].description}))
		for (const agent of Object.values(agents))
			if (agent.availability && !scores.find(e => e.id == agent.id)) scores.push({...agent, pos:'', pc:0})
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify(scores))
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error getting scores"}')
	}
})
server.get('/agents/:key',async (req,res) => {
	try{
		const text = req.params.key.toLowerCase()
		const agents = await ps.get_agents()
		const list = Object.values(agents).map(e => ({id:e.id, name:e.name || '', desc: e.description || '', avail:e.availability})).filter(e => e.name.toLowerCase().includes(text) || e.desc.toLowerCase().includes(text));
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify(list))
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error getting agents list"}')
	}
})
server.get('/path/:account/:id',async (req,res) => {
	try{
		const account = req.params.account.toLowerCase()
		const id = req.params.id.toLowerCase()
		const agents = await ps.get_agents(1)
		const agent = agents.find(e => e.path?.toLowerCase() == account+'/'+id);
		if (!agent) throw Error('no agent found')
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify(agent))
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error getting agent path"}')
	}
})
server.get('/agent/:id',async (req,res) => {
	try{
		const agents = await ps.get_agents()
		if (!agents[req.params.id]) throw Error('agent not found') 

		let agent_scores = await ps.get_score(req.params.id)	
		const data = {id:agents[req.params.id].id, name:agents[req.params.id].name, availability:agents[req.params.id].availability, owner:agents[req.params.id].path?.split('/')[0], description:agents[req.params.id].description, result:[0,0]}
		if (agent_scores) data.result = agent_scores.split('/').map(e => +e)
		data.pc = Math.round(data.result[0]*100/(data.result[0]+data.result[1])) 
		if (data.pc == null) data.pc == '' 

		const pair_agent = await ps.get_pairs(req.params.id)
		const scores = await ps.get_scores(req.params.id)
		data.opponents = scores.filter(e => pair_agent[e.pair_id]).map(e => ({...e, name:agents[pair_agent[e.pair_id]]?.name, availability:agents[pair_agent[e.pair_id]].availability})).filter(e => e.name) //  && e.availability 
		for (const agent of Object.values(agents)){
			const pair_id = await ps.get_pair(req.params.id, agent.id)
			if (agent.availability && req.params.id!=agent.id && !scores.find(e => e.pair_id == pair_id)) data.opponents.push({...agent, pair_id, pos:'', res_text:'0/0'}) // 
		}		
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify(data))
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error getting agent data"}')
	}
})
server.get('/pair/:id',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	try{
		const pair_data = req.params.id.split('.')
		if (pair_data.length!=2) throw Error('wrong pair parameter')
		const agents_pair = await ps.get_by_pair(pair_data[1])
		if (!agents_pair) throw Error('pair not found') 

		const x = agents_pair.split('.')
		const agents = await Promise.all(x.map(ps.get_agent_data))
		const data = {pair_id:pair_data[1], agents:agents.filter(e => e && !e.err).map(e => ({id:e.id, name:e.name, availability:e.availability}))}
		if (data.agents.length!=2) throw Error('error getting agent data')  
		if (data.agents[0].id != pair_data[0]) data.agents = [data.agents[1],data.agents[0]]

		const scores = await ps.get_score(req.params.id)
		data.scores = scores ? scores.split('/').map(e => +e) : [0,0]

		const list = await ps.get_closed(pair_data[1])
		data.history = list.map(e => ({date:e.date, closed:e.closed, date_text:new Date(e.closed).toISOString().replace('T',', ').substr(0,17), winner:e.game[e.winner]?.id, scores: e.game['0'].id == data.agents[0].id? e.scores['0']+'-'+e.scores['X'] : e.scores['X']+'-'+e.scores['0']})).reverse()

		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify(data))
	}catch(err){
		console.log(err)
		res.end('{"error":"error getting pair data"}')
	}
})
server.get('/archive/:id',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	const data = await ps.get_archive(req.params.id)
	if (!data || data.err) return res.end('{"error":"'+(data?data.err:'archive game not found')+'"}')
	let log_text=''
	try {
		log_text = fs.readFileSync('logs/'+data.id+'.log','utf-8').toString()
	}catch(err){}
	res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
	return res.end(JSON.stringify({...data, log_text}))
})
server.get('/game/:id',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	const parcedUrl = parseUrl(req)
	const data = await ps.get_game(req.params.id)
	if (!data || data?.err) return res.end('{"error":"'+(data?.err || 'no active game found')+'"}')
	res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
	try {
		const log_fn = 'logs/'+data.id+'.log'
		const stats = fs.statSync(log_fn)
		if (!parcedUrl?.query?.startsWith('forced') && await ps.check_log_size(data.id, stats.size, 60)) return res.end('{"no_changes":1}')
		data.log_text = fs.readFileSync(log_fn,'utf-8').toString()
	}catch(err){
		console.log(err)
	}
	res.end(JSON.stringify(data))
})
server.post('/agent',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	try{
		const data = {path:req.body?.path?.trim()?.substr(0,150), name:req.body?.name?.trim()?.substr(0,50), pin:req.body?.pin?.trim()?.substr(0,50), description:req.body?.description?.trim()?.substr(0,100)}
		if (!data.path?.length || !data.name?.length || !data.pin?.length) return res.end('{"error":"Invalid request format"}')
		const path = data.path.toLowerCase()	
		const id_arr = path.split('/');
		if (!(id_arr.length == 2 && addressValid(id_arr[0]) && id_arr[1].length)) return res.end('{"error":"Invalid request format"}')

		const common_timeout = process.env.TIMEOUT ? +process.env.TIMEOUT : 180
		data.timeout = (/^\d{1,3}$/.test(req.body?.timeout) ? +req.body.timeout : common_timeout) || common_timeout
		if (data.timeout>common_timeout) data.timeout = common_timeout
		if (data.timeout<60) data.timeout = 60

		if (await ps.check_flood('agent_time.'+path,60)) return res.end('{"error":"brutforce protection"}')

		const agents = await ps.get_agents(1)
		const low_name = data.name.toLowerCase()	
		const agent_data = agents.find(e => e.path && e.path.toLowerCase() == path)
		let updated_data = {}
		if (agent_data){
			if (agent_data?.pin != data?.pin) return res.end('{"error":"Wrong PIN code"}')
			if (agent_data?.name?.toLowerCase()!=low_name && agents.find(e => e.name.toLowerCase() == low_name)) return res.end('{"error":"The name is not unique"}')
			updated_data = await ps.update_agent({...data, id:agent_data.id, availability: agent_data.availability && !req.body.pending})	
			if (updated_data.err) return res.end('{"error":"Error updating near.ai agent data"}')
		} else {
			if (agents.find(e => e.name.toLowerCase() == low_name)) return res.end('{"error":"The name is not unique"}')
			const is_agent = await nearai.find_agents(id_arr[0], id_arr[1])	
			if (!is_agent) return res.end('{"error":"Near.ai agent not found"}')
			updated_data = await ps.update_agent(data)	
			if (updated_data.err) return res.end('{"error":"Error updating near.ai agent data"}')
		}
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify({"id":updated_data.id}))
	}catch(err){
		console.log(err)
		res.end('{"error":"error updating near.ai agent data"}')
	}
})
server.post('/agents',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	try{
		const owner_id = req.body?.owner_id?.trim()?.toLowerCase()
		const name     = req.body?.name?.trim()?.toLowerCase()
		if (!addressValid(owner_id) || !name?.length) return res.end('{"error":"invalid format of near.ai agent ID"}')
		const result = await nearai.find_agents(owner_id, name)
		if (!result) return res.end('{"error":"no agent found"}')
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end(JSON.stringify({"result":"ok"}))
	}catch(err){
		console.log(err)
		res.end('{"error":"error getting data near.ai agent"}')
	}
})
server.post('/pair/:id',async (req,res) => {
	try{
		await play.create_game(req.params.id)
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end('{"status":"ok"}')
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error creating game"}')
	}
})
server.post('/game/:id',async (req,res) => {
	try{
		const fields = ['id','date','count','board','turn','current','game'], game = {}
		for (const key of fields){
			if (req.body[key] == undefined) throw Error('wrong game payload')
			game[key] = req.body[key]
		}
		await play.create_human_game(game)
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end('{"status":"ok"}')
	}catch(err){
		console.log(err)
		res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
		res.end('{"error":"error creating game with human"}')
	}
})
server.delete('/game/:id',async (req,res) => {
	res.writeHead(400,{'Content-Type':'application/json', ...debug_s})
	try{
		const result = await ps.get_game(req.params.id)
		if (result?.err) res.end('{"error":"no game found}"')
		if (!result.winner) res.end('{"error":"game is not over}"')	
		await ps.del_game(req.params.id)
		res.writeHead(200,{'Content-Type':'application/json; charset=utf-8', ...debug_s})
		res.end('{"status":"ok"}')
	}catch(err){
		console.log(err)
		res.end('{"error":"error deleting game"}')
	}
})

server.listen(5000, err => console.log(err?err:'"othello ai wars" service running...'))
