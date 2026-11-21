import { describe, expect, it } from 'vitest'
import { mergeTemplate, parseEmailList } from './merge-fields'

describe('mergeTemplate', () => {
  it('fills known fields and leaves unknown ones', () => {
    expect(mergeTemplate('Hi {customer_first_name}, quote {quote_number} is {total}. {nope}', { customer_first_name: 'Dana', quote_number: 'Q-1001', total: '$240.84' })).toBe(
      'Hi Dana, quote Q-1001 is $240.84. {nope}'
    )
  })
  it('fills a field that is an empty string', () => {
    expect(mergeTemplate('Hi {customer_first_name},', { customer_first_name: '' })).toBe('Hi ,')
  })
  it('repeats', () => expect(mergeTemplate('{shop_name} / {shop_name}', { shop_name: 'Ink' })).toBe('Ink / Ink'))
})

describe('parseEmailList', () => {
  it('splits and validates', () => {
    expect(parseEmailList('a@x.com, b@y.org; bad  a@x.com')).toEqual({ valid: ['a@x.com', 'b@y.org'], invalid: ['bad'] })
    expect(parseEmailList('')).toEqual({ valid: [], invalid: [] })
  })
})
