#!/usr/bin/env node

const fs = require('fs')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseBigIntString(value) {
  return Number(BigInt(value))
}

function parseNumberString(value) {
  const number = Number(value)
  if (Number.isNaN(number)) {
    fail(`Unable to parse numeric value '${value}'`)
  }
  return number
}

function loadJson(path) {
  const content = fs.readFileSync(path, 'utf8').trim()
  if (content === '') {
    return {
      type: 'tap-stats',
      generatedAt: Date.now(),
      scope: 'event',
      groups: [],
    }
  }
  return JSON.parse(content)
}

function groupsByLabel(report) {
  return new Map((report.groups ?? []).map(group => [group.label, group]))
}

function compareNumbers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function table(rows) {
  if (rows.length === 0) {
    return ''
  }

  const widths = rows[0].map((_, index) => Math.max(...rows.map(row => `${row[index]}`.length)))
  return rows.map(row => row.map((value, index) => `${value}`.padEnd(widths[index])).join('  ')).join('\n')
}

function percentage(count, total) {
  if (total === 0) {
    return 0
  }
  return (count * 100) / total
}

function formatPercent(count, total) {
  return `${percentage(count, total).toFixed(2)}%`
}

function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) {
    return { low: 0, high: 0 }
  }

  const phat = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (phat + z2 / (2 * total)) / denominator
  const margin =
    (z / denominator) * Math.sqrt((phat * (1 - phat)) / total + z2 / (4 * total * total))

  return {
    low: Math.max(0, center - margin) * 100,
    high: Math.min(1, center + margin) * 100,
  }
}

function formatPercentWithCi(count, total) {
  const interval = wilsonInterval(count, total)
  return `${formatPercent(count, total)} [${interval.low.toFixed(2)}%, ${interval.high.toFixed(2)}%]`
}

function getCategoryEntries(group) {
  if (group?.bools) {
    return [
      { value: 'true', count: group.bools.trueCount, total: group.bools.count },
      { value: 'false', count: group.bools.falseCount, total: group.bools.count },
    ]
  }

  if (group?.strings) {
    return group.strings.entries.map(entry => ({ value: entry.value, count: entry.count, total: group.strings.count }))
  }

  if (group?.structures) {
    return group.structures.entries.map(entry => ({ value: entry.value, count: entry.count, total: group.structures.count }))
  }

  return []
}

function summarizeGroup(group) {
  if (!group) {
    return 'missing'
  }

  if (group.ints) {
    return `avg=${group.ints.avg} p50=${group.ints.p50} p90=${group.ints.p90}`
  }

  const entries = getCategoryEntries(group)
    .filter(entry => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, 3)

  if (entries.length > 0) {
    return entries.map(entry => `${JSON.stringify(entry.value)}=${formatPercent(entry.count, entry.total)}`).join(', ')
  }

  return 'empty'
}

function selectLabels(leftGroups, rightGroups, options) {
  if (options.labels.length > 0) {
    return options.labels
  }

  const shared = [...leftGroups.keys()].filter(label => rightGroups.has(label))
  return shared
    .filter(label => (options.prefix ? label.startsWith(options.prefix) : true))
    .sort((left, right) => left.localeCompare(right))
}

function compareReports(leftName, leftReport, rightName, rightReport, options) {
  const leftGroups = groupsByLabel(leftReport)
  const rightGroups = groupsByLabel(rightReport)
  const labels = selectLabels(leftGroups, rightGroups, options)

  if (labels.length === 0) {
    fail('No shared labels found for comparison')
  }

  const rows = [['label', 'metric', leftName, rightName, 'delta']]

  for (const label of labels) {
    const left = leftGroups.get(label)
    const right = rightGroups.get(label)

    if (left?.ints && right?.ints) {
      for (const metric of ['avg', 'p50', 'p90']) {
        const leftValue = parseNumberString(left.ints[metric])
        const rightValue = parseNumberString(right.ints[metric])
        rows.push([
          label,
          metric,
          left.ints[metric],
          right.ints[metric],
          `${(rightValue - leftValue).toFixed(2)}`,
        ])
      }
      continue
    }

    const leftEntries = getCategoryEntries(left)
    const rightEntries = getCategoryEntries(right)
    if (leftEntries.length > 0 && rightEntries.length > 0) {
      const totals = {
        left: leftEntries[0].total,
        right: rightEntries[0].total,
      }
      const values = [...new Set([...leftEntries.map(entry => entry.value), ...rightEntries.map(entry => entry.value)])]
      values
        .sort((leftValue, rightValue) => {
          const leftCount = leftEntries.find(entry => entry.value === leftValue)?.count ?? 0
          const rightCount = rightEntries.find(entry => entry.value === rightValue)?.count ?? 0
          return compareNumbers(rightCount, leftCount) || leftValue.localeCompare(rightValue)
        })
        .slice(0, options.categoryLimit)
        .forEach(value => {
          const leftCount = leftEntries.find(entry => entry.value === value)?.count ?? 0
          const rightCount = rightEntries.find(entry => entry.value === value)?.count ?? 0
          rows.push([
            label,
            JSON.stringify(value),
            formatPercentWithCi(leftCount, totals.left),
            formatPercentWithCi(rightCount, totals.right),
            `${(percentage(rightCount, totals.right) - percentage(leftCount, totals.left)).toFixed(2)} pp`,
          ])
        })
      continue
    }

    rows.push([label, 'summary', summarizeGroup(left), summarizeGroup(right), 'n/a'])
  }

  console.log(table(rows))
}

function getGroupValueForCondition(group, operator, expectedRaw) {
  if (!group) {
    return { kind: 'missing' }
  }

  if (group.ints) {
    return { kind: 'number', value: parseNumberString(group.ints.avg), raw: group.ints.avg }
  }

  if (group.bools) {
    const expected = expectedRaw.toLowerCase()
    if (expected !== 'true' && expected !== 'false') {
      fail(`Boolean condition expects true or false, got '${expectedRaw}'`)
    }
    return { kind: 'boolean', value: expected === 'true' ? group.bools.trueCount > 0 : group.bools.falseCount > 0 }
  }

  const entries = getCategoryEntries(group)
  if (entries.length > 0) {
    return { kind: 'category', entries }
  }

  return { kind: 'missing' }
}

function evaluateCondition(report, expression) {
  const match = expression.match(/^([^=!<>]+)\s*(<=|>=|!=|=|<|>)\s*(.+)$/)
  if (!match) {
    fail(`Unsupported condition '${expression}'. Expected label=value, label!=value, label>=n, ...`)
  }

  const [, rawLabel, operator, rawExpected] = match
  const label = rawLabel.trim()
  const expected = rawExpected.trim()
  const group = groupsByLabel(report).get(label)
  const actual = getGroupValueForCondition(group, operator, expected)

  if (actual.kind === 'missing') {
    return false
  }

  if (actual.kind === 'number') {
    const expectedNumber = parseNumberString(expected)
    switch (operator) {
      case '=':
        return actual.value === expectedNumber
      case '!=':
        return actual.value !== expectedNumber
      case '>':
        return actual.value > expectedNumber
      case '>=':
        return actual.value >= expectedNumber
      case '<':
        return actual.value < expectedNumber
      case '<=':
        return actual.value <= expectedNumber
      default:
        return false
    }
  }

  if (actual.kind === 'boolean') {
    if (operator !== '=' && operator !== '!=') {
      fail(`Boolean condition '${expression}' must use = or !=`)
    }
    return operator === '=' ? actual.value : !actual.value
  }

  if (actual.kind === 'category') {
    if (operator !== '=' && operator !== '!=') {
      fail(`Categorical condition '${expression}' must use = or !=`)
    }
    const found = actual.entries.some(entry => entry.value === expected && entry.count > 0)
    return operator === '=' ? found : !found
  }

  return false
}

function summarizeSweep(manifest, labels, outJsonPath) {
  const rows = [['case', 'target', 'seed', 'maxSteps', 'label', 'summary']]
  const structured = []

  for (const run of manifest) {
    const report = loadJson(run.reportPath)
    const reportGroups = groupsByLabel(report)
    for (const label of labels) {
      const group = reportGroups.get(label)
      const summary = summarizeGroup(group)
      rows.push([run.caseName, run.target, `${run.seed}`, `${run.maxSteps}`, label, summary])
      structured.push({
        caseName: run.caseName,
        target: run.target,
        seed: run.seed,
        maxSteps: run.maxSteps,
        label,
        summary,
      })
    }
  }

  console.log(table(rows))
  if (outJsonPath) {
    fs.writeFileSync(outJsonPath, `${JSON.stringify(structured, null, 2)}\n`, 'utf8')
  }
}

function parseOptionValue(argumentsList, prefix) {
  const argument = argumentsList.find(item => item.startsWith(`${prefix}=`))
  return argument ? argument.slice(prefix.length + 1) : undefined
}

function runCli() {
  const [, , command, ...args] = process.argv

  switch (command) {
    case 'compare': {
      if (args.length < 4) {
        fail('Usage: stats-tools.js compare <left-name> <left-report.json> <right-name> <right-report.json> [--labels=a,b] [--prefix=prefix]')
      }
      const [leftName, leftPath, rightName, rightPath, ...options] = args
      compareReports(leftName, loadJson(leftPath), rightName, loadJson(rightPath), {
        labels: (parseOptionValue(options, '--labels') ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
        prefix: parseOptionValue(options, '--prefix') ?? '',
        categoryLimit: parseNumberString(parseOptionValue(options, '--category-limit') ?? '8'),
      })
      break
    }
    case 'filter': {
      if (args.length < 2) {
        fail('Usage: stats-tools.js filter <report.json> <condition> [<condition> ...]')
      }
      const [reportPath, ...conditions] = args
      const report = loadJson(reportPath)
      const matched = conditions.every(condition => evaluateCondition(report, condition))
      process.exit(matched ? 0 : 1)
      break
    }
    case 'sweep': {
      if (args.length < 1) {
        fail('Usage: stats-tools.js sweep <manifest.json> --labels=a,b [--out-json=path]')
      }
      const [manifestPath, ...options] = args
      const labels = (parseOptionValue(options, '--labels') ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
      if (labels.length === 0) {
        fail('stats-tools.js sweep requires --labels=label1,label2,...')
      }
      summarizeSweep(loadJson(manifestPath), labels, parseOptionValue(options, '--out-json'))
      break
    }
    default:
      fail('Usage: stats-tools.js <compare|filter|sweep> ...')
  }
}

if (require.main === module) {
  runCli()
}

module.exports = {
  loadJson,
  groupsByLabel,
  summarizeGroup,
  evaluateCondition,
  compareReports,
}
