const fs     = require('fs')
const crypto = require('crypto')
const db     = require('./db.js')

const local_agents = require('./agents.json')
for (let k=0; k<local_agents.length; k++)
	if (!local_agents[k].prompt && !local_agents[k].path) local_agents[k].prompt = fs.readFileSync(local_agents[k].id+'.pmt','utf-8').toString()
db.op('batch','agents',local_agents.filter(e => !e.path).map(e => ({type:'put', key:e.id, value:JSON.stringify(e)})))

const closed_deep  = 15

exports.del_game    	 = (id) => db.op('del','games', id)
exports.get_game    	 = (id) => db.op('get','games', id)
exports.get_archive 	 = (id) => db.op('get','closed',id)
exports.get_score   	 = (id) => db.op('get','scores',id,1,1)
exports.get_by_pair 	 = (id) => db.op('get','pairs', id,1,1)
exports.get_agent_data   = (id) => db.op('get','agents',id,0,1)
exports.update_game 	 = (id,data,clear) => db.op('upd','games',id,data,clear)
exports.set_busy         = (id,busy = Date.now()) => exports.update_game(id,{busy})
exports.get_closed  	 = (pair_id) => db.op('list','closed',{prefix:pair_id+'.'},1)
exports.set_availability = (agent_id, availability) => db.op('upd','agents',agent_id,{availability})
exports.get_games = async (active) => {
    if (!active) return db.op('list','games',{},1)
    return new Promise((resolve, reject) => {
        const result = []
        const common_timeout = process.env.TIMEOUT ? +process.env.TIMEOUT : 180
        db.bases['games'].createReadStream({keys:true, values:true})
            .on('data',data => {
                const game = JSON.parse(data.value)
                if (!game.game[game.current].id.startsWith('human-') && (!game.busy || (Date.now()-game.busy > (common_timeout+2)*1000)))
                    result.push({...game, key:data.key})
            })
            .on('error', err => reject(err))
            .on('close', _ => resolve(result))
      })
}
exports.get_agents = async (mode) => {
    return new Promise((resolve, reject) => {
        const result = mode?[]:{}
        db.bases['agents'].createReadStream({keys:true, values:true})
            .on('data', data => {
                if (!mode){	
                    const v = JSON.parse(data.value)
                    result[v.id] = v
                } else result.push(JSON.parse(data.value))
            })
            .on('error', err => reject(err))
            .on('close', _ => resolve(result))
    })
}
exports.get_scores = async (agent_id) => {
    return new Promise((resolve, reject) => {
        const list = [], options = {keys:true, values:true}
        if (agent_id) {
            options.gt = agent_id+'.'
            options.lt = agent_id+'.z'
        }	
        db.bases['scores'].createReadStream(options)
            .on('data', data => {
                const result = data.value.split('/').map(e => +e)
                if (agent_id) list.push({pair_id:data.key.split('.').pop(), res_text:data.value, pc:Math.round(result[0]*100/(result[0]+result[1]))})
                else if (!data.key.includes('.')) list.push({id:data.key, result, pc:Math.round(result[0]*100/(result[0]+result[1]))})
            })
            .on('error', err => reject(err))
            .on('close', _ => {
                list.sort((a,b) => (agent_id ? a.pc>b.pc : a.pc<b.pc)?1:-1)
                list.forEach((e,k) => list[k] = {...list[k], pos:k+1})
                resolve(list)
            })
    })
}
exports.get_pairs = async (agent_id) => {
    return new Promise((resolve, reject) => {
        const list = [], result = {}, options = {keys:true, values:true}
        if (agent_id) {
            options.gt = agent_id+'.'
            options.lt = agent_id+'.z'
        }	
        db.bases['pairs'].createReadStream(options)
            .on('data',data => {
                if (agent_id) result[data.value] = data.key.split('.').pop() 
                else if (!data.key.includes('.')) list.push(data.key)
            })
            .on('error', err => reject(err))
            .on('close', _ => resolve(agent_id ? result : list))
    })
}
exports.update_agent = async (data) => {
    const new_rec = !data.id
    if (new_rec){
        let id = crypto.randomBytes(8).toString('hex')
        while (await db.op('get','agents',id)) id = crypto.randomBytes(8).toString('hex')
        data = {...data, id}	
    } 
    return db.op('upd', 'agents', data.id, data, new_rec)
}
exports.get_pair = async (agent_id1, agent_id2) => {
    try{
        const key1 = agent_id1+'.'+agent_id2
        const key2 = agent_id2+'.'+agent_id1
        let pair_id = await db.op('get','pairs',key1,1) || await db.op('get','pairs',key2,1)
        if (pair_id) return pair_id
        pair_id = crypto.randomBytes(8).toString('hex')
        while (await db.op('get','pairs',pair_id,1)) pair_id = crypto.randomBytes(8).toString('hex')
        await db.op('batch','pairs',[{type:'put', key:key1, value:pair_id},{type:'put', key:key2, value:pair_id},{type:'put', key:pair_id, value:key1}])
        return db.op('get','pairs',key1,1)
    }catch(err){
        return {err}
    }
}
exports.del_agents_pairs = async (agent_id) => {
    try{
        const keys = []
        for (const e of await db.op('list','pairs', {prefix:agent_id, nojson:1}))
            keys.push(e.value, e.key, e.key.split('.').reverse().join('.'))
        await db.op('batch','pairs',keys.map(key =>({type:'del', key})))
    }catch(err){
        console.log(err)
    }
}
exports.calculate_all = () => exports.get_pairs().then(pairs => pairs.forEach(pair => calculate_scores(pair))).catch(console.log)
calculate_scores = async (pair_id, looser_id) => {
    try{
        let list = await db.op('list','closed',{prefix:pair_id+'.'},1) 
        if (list.length > closed_deep){
            const removed = list.splice(0, list.length-closed_deep)
            for (const rec of removed)
                fs.unlink('logs/'+rec.id+'.log', (err) => {if (err) console.error(err)})
            db.op('batch','closed',removed.map(e => ({type:'del', key:e.id})))
        }
		
        let pending = list.length>2, k=1
        while (pending && k<4){
            pending = pending && !list[list.length-k].scores['0'] && !list[list.length-k].scores['X']
            k++
        }
        if (pending && looser_id) exports.set_availability(looser_id, 0)
		    list = list.filter(e => '0X'.includes(e.winner) && (e.scores['0'] || e.scores['X']))
        if (!list.length) return
		
        const scores = {}
        scores[list[0].game['0'].id] = 0
        scores[list[0].game['X'].id] = 0
        for (const winner of list.map(e => e.game[e.winner].id)) scores[winner]++

        let batch_list = [] 
        try{
            const agents_data = await Promise.all(Object.keys(scores).map(player => db.op('get','agents',player)))
            if (!agents_data[0].availability || !agents_data[1].availability){ 
                const pending_player_id = !agents_data[0].availability ? agents_data[0].id : agents_data[1].id
                for (const score of await db.op('list','scores',{prefix:pending_player_id+'.', nojson:1},1)){
                    batch_list.push({type:'del', key:score.key})
                    batch_list.push({type:'del', key:score.key.split('.').reverse().join('.')})
                }
            } else {
                for (const winner of Object.keys(scores))
                    batch_list.push({type:'put', key:winner+'.'+pair_id, value:''+scores[winner]+'/'+(list.length-scores[winner])})
            }
            await db.op('batch','scores',batch_list)
        }catch(err){}	
		
        batch_list = [] 
        for (const player of Object.keys(scores)){
            try{
                const score_list = await db.op('list','scores',{prefix:player+'.', nojson:1},1)  
                const scores = [0,0]
                score_list.map(e => e.value.split('/').map((e,k) => scores[k] += +e))
                batch_list.push({type:'put', key:player, value:scores.join('/')})
            }catch(err){
                console.log(err)
            }
        }
        await db.op('batch','scores',batch_list)
    }catch(err){
        console.log(err)
    }
}
exports.archive_game = async (game) => {
    const reverse = {'0':'X','X':'0'}
    await db.op('del','games',game.key)
    delete game.key
    if (game.id.startsWith('human-')) return
    await db.op('set','closed',game.id,game)
    return calculate_scores(game.id.split('.')[0], game.game[reverse[game.winner]]?.id)
}
exports.check_exp_games = async () => {
    const now = Date.now(), threads = []
    const games   = await db.op('list','games')
    if (games.err) throw Error(err)
    games.forEach(e => threads.push(e.game['0']?.thread_id, e.game['X']?.thread_id)) 
    const expired = games.filter(e => (now-e.date)/3600000 > 24).map(e => e.key) 
    if (expired.length) db.op('batch','games', expired.map(e => ({type:'del', key:e})))
    return threads.filter(e => e)
}
exports.check_flood = async (id, time) => {
    const v = await db.op('get', 'temp', id, 1)
    if (v && !v.err && Date.now()-v < time*1000) return true
    await db.op('set', 'temp', id, Date.now(), 1)
    setTimeout(async () => {
        const v = await db.op('get', 'temp', id, 1)
        if (v && (v.err || Date.now()-v > time*1000)) db.op('del','temp',id)
    }, time*1000)
}
exports.check_log_size = async (id, size, time) => {
    const v = await db.op('get','temp','log_size.'+id)
    if (v?.size == size && Date.now()-v.time < time*1000) return true
    db.op('set','temp','log_size.'+id, {size, time:Date.now()})
}
exports.del_log_size     = (id) => db.op('del','temp','log_size.'+id)
