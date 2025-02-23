const fs = require('fs')
const reverse = {'0':'X','X':'0'}

const allow = (board,i,j) => {
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
exports.turns = (board) => {
    const letters = 'abcdefgh'
    const result = {'0':[],'X':[]}
    for (let i=0; i<board.length; i++){
        for (let j=0; j<board[i].length; j++){
            if (board[i][j]=='.'){
                const allows = allow(board,i,j)
                const t = letters[j]+(8-i)
                if (allows['0'].length && !allows['0'].includes(t)) result['0'].push(t)
                if (allows['X'].length && !allows['X'].includes(t)) result['X'].push(t)
            }
        }		
    }
    return result
}
exports.fill = (board,i,j,token) => {
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
exports.scores = (board) => {
    const result = {'0':0,'X':0,'.':0}
    for (let i=0; i<8; i++)
    for (let j=0; j<8; j++)
    result[board[i][j]]++
    return result
}
exports.text_board = (board, show_coordinates) => board.map((e,i) => (show_coordinates?(8-i)+' ':'')+e.join('')).join('\n')+(show_coordinates?'\n  abcdefgh':'')
