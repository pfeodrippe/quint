module.exports = {
  add1(x) {
    return { '#bigint': (BigInt(x['#bigint']) + 1n).toString() }
  },

  answer() {
    return { '#bigint': '42' }
  },

  pair() {
    return { '#tup': [{ '#bigint': '1' }, { '#bigint': '2' }] }
  },
}
