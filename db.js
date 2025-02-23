const fs    = require('fs'); for (folder of fs.readdirSync('./db')) try {fs.unlinkSync('./db/'+folder+'/LOCK')} catch(err) {}
const level = require('level')

exports.bases = {
    agents: level('./db/agents'),
    pairs:  level('./db/pairs'),
    games:  level('./db/games'),
    closed: level('./db/closed'),
    scores: level('./db/scores'),
    temp:   level('./db/temp')
}

exports.op = async (mode, base, id, data, param) => {
    try{
        switch (mode) {
            case 'get':
                const v = await exports.bases[base].get(id)
                return data?v:JSON.parse(v)
            case 'upd':
                if (!param){
                    const v = await exports.op('get',base,id)
                    if (!v || v.err) return {err: v?.err || 'object for update not found'}
                    Object.keys(data).forEach(k => v[k] = data[k])
                    await exports.bases[base].put(id,JSON.stringify(v))
                    return v
                }
            case 'set':
                await exports.bases[base].put(id, typeof data=='string' ? data : JSON.stringify(data))
                return mode == 'upd' ? data : {'ok':1}
            case 'del':
                await exports.bases[base].del(id)
                return {'ok':1, 'status':'deleted'}
            case 'batch':
                await exports.bases[base].batch(id)
                return {'ok':1}
            case 'list':
                return new Promise((resolve, reject) => {
                    const list = []
                    exports.bases[base].createReadStream({keys:true, values:true, ...(id?.options || {}), ...(typeof id?.prefix == 'string' ? {gt:id.prefix, lt:id.prefix+'~'} : {})})
                        .on('data',  v => list.push(id?.nojson ? {key:v.key, value:v.value} : {key:v.key, ...JSON.parse(v.value)}))
                        .on('error', err => reject(err))
                        .on('close', _ => resolve(list))
                })
            default:
                return {err:'redis operation type not found'}
        }
    } catch(err) {
        if (mode == 'list' && data) throw Error(err)
        if (mode == 'get'){
            if (err.toString().substr(0,14) == 'NotFoundError:') return 
            if (param) throw Error(err)
        }
        console.log(err)
        return {err}
    }
}
