const fetch  = require('node-fetch')
const ps     = require('./ps.js')
const token  = JSON.stringify(require('./token.json'))

const common_timeout = process.env.TIMEOUT ? +process.env.TIMEOUT : 180
const find_agents_cache = {}

exports.request = async (id, method='GET', body, timeout=common_timeout*1000, options={}) => {
	const res = await fetch('https://api.near.ai/v1/'+id, {method, body:body?JSON.stringify(body):undefined, headers:{"content-type":"application/json", "Authorization":"Bearer "+token}, signal:AbortSignal.timeout(timeout), ...options})
	if (res.ok == false && !options.no_error) throw Error(await res.text())
	return res.json()
}
exports.create_thread = (agent_id, new_message, timeout) => exports.request('agent/runs','POST',{agent_id, new_message}, timeout)	
exports.delete_thread = (thread_id) => {exports.request('threads/'+thread_id,'DELETE').catch(console.error)}
exports.find_agents = async (owner_id, agent_name) => {
	const ttl = 300000
	const agents = find_agents_cache[owner_id]?.agents || {}
	if (!find_agents_cache[owner_id]?.time || (Date.now() - find_agents_cache[owner_id].time > ttl)){
		const list = await exports.request('find_agents', 'POST', {owner_id})	
		for (const name of list.map(e => e.name.toLowerCase())) agents[name]=1
		find_agents_cache[owner_id] = {time:Date.now(), agents}
		setTimeout(() => delete find_agents_cache[owner_id], ttl)
	}
	return find_agents_cache[owner_id].agents[agent_name]
}
exports.get_thread = (thread_id) => exports.request('threads/'+thread_id,'GET', null, 60000, {no_error:1})	
exports.get_messages = (thread_id) => exports.request('threads/'+thread_id+'/messages')	
exports.send_message = (agent_id, thread_id, new_message, timeout) => exports.request('threads/runs','POST',{agent_id, thread_id, new_message}, timeout)		
exports.get_answers = async (thread_id) => {
	try{
		const data = await exports.request('threads/'+thread_id+'/messages')	
		if (data?.data){
			const result = []
			for (const m of data.data){
				if (m.role == 'user') break
				if (m?.content?.length) result.push(m?.content[0].text?.value)
			}
			if (result.length) return result.reverse()
		}
	}catch(err){
		console.log(err)
	}
}

setInterval(() => ps.check_exp_games().then(threads => threads.forEach(exports.delete_thread)).catch(console.error), 3600000)
