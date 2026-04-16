module.exports = {
  add1(x) {
    return { '#bigint': (BigInt(x['#bigint']) + 1n).toString() }
  },

  answer() {
    return { '#bigint': '42' }
  },
}
