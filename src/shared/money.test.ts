import { describe, expect, it } from 'vitest'
import { applyBp, bpToPercentString, centsToPlain, divRound, formatMoney, parseMoney, parsePercent, roundToStep, sumCents } from './money'

describe('divRound', () => {
  it('rounds half up for positives', () => {
    expect(divRound(5, 10)).toBe(1)
    expect(divRound(4, 10)).toBe(0)
    expect(divRound(15, 10)).toBe(2)
    expect(divRound(25, 10)).toBe(3)
  })
  it('rounds half away from zero for negatives', () => {
    expect(divRound(-5, 10)).toBe(-1)
    expect(divRound(-4, 10)).toBe(0)
  })
  it('rejects non-integers and zero denominators', () => {
    expect(() => divRound(1.5, 2)).toThrow()
    expect(() => divRound(1, 0)).toThrow()
  })
})

describe('applyBp', () => {
  it('computes 8.25% tax on $100.00', () => expect(applyBp(10000, 825)).toBe(825))
  it('rounds half a cent up', () => expect(applyBp(1006, 500)).toBe(50)) // 50.3 → 50
  it('rounds .5 cent up', () => expect(applyBp(10, 5000)).toBe(5)) // 5.0
  it('7% of $0.50 = 3.5c → 4c', () => expect(applyBp(50, 700)).toBe(4))
})

describe('roundToStep', () => {
  it('nickel', () => {
    expect(roundToStep(1232, 5)).toBe(1230)
    expect(roundToStep(1233, 5)).toBe(1235)
    expect(roundToStep(1237, 5)).toBe(1235)
  })
  it('quarter', () => {
    expect(roundToStep(1212, 25)).toBe(1200)
    expect(roundToStep(1213, 25)).toBe(1225) // 12.5 rounds up
    expect(roundToStep(1238, 25)).toBe(1250)
  })
  it('cent is a no-op', () => expect(roundToStep(1237, 1)).toBe(1237))
})

describe('parseMoney', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['$1,234.56', 123456],
    ['.99', 99],
    ['0', 0],
    ['-3.10', -310],
    [' 7. ', 700]
  ])('%s → %i', (s, c) => expect(parseMoney(s)).toBe(c))
  it.each(['', 'abc', '1.234', '1.2.3', '.', '-'])('rejects %j', (s) => expect(parseMoney(s)).toBeNull())
  it('accepts numbers', () => expect(parseMoney(19.99)).toBe(1999))
})

describe('formatting', () => {
  it('formatMoney', () => {
    expect(formatMoney(123456)).toBe('$1,234.56')
    expect(formatMoney(5)).toBe('$0.05')
    expect(formatMoney(-250)).toBe('-$2.50')
  })
  it('centsToPlain', () => expect(centsToPlain(1205)).toBe('12.05'))
  it('percent round trip', () => {
    expect(parsePercent('8.25')).toBe(825)
    expect(bpToPercentString(825)).toBe('8.25')
    expect(bpToPercentString(800)).toBe('8')
    expect(bpToPercentString(850)).toBe('8.5')
  })
  it('sumCents', () => expect(sumCents([1, 2, 3])).toBe(6))
})
