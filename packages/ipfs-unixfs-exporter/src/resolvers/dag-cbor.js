'use strict'

const CID = require('multiformats/cid')
const errCode = require('err-code')
// @ts-ignore
const dagCbor = require('@ipld/dag-cbor')

/**
 * @typedef {import('../types').Resolver} Resolver
 */

/**
 * @type {Resolver}
 */
const resolve = async (cid, name, path, toResolve, resolve, depth, blockService, options) => {
  const block = await blockService.get(cid)
  const object = dagCbor.decode(block.bytes)
  let subObject = object
  let subPath = path

  while (toResolve.length) {
    const prop = toResolve[0]

    if (prop in subObject) {
      // remove the bit of the path we have resolved
      toResolve.shift()
      subPath = `${subPath}/${prop}`

      // @ts-ignore
      const subObjectCid = CID.asCID(subObject[prop])
      if (subObjectCid) {
        return {
          entry: {
            type: 'object',
            name,
            path,
            cid,
            node: block.bytes,
            depth,
            size: block.length,
            content: async function * () {
              yield object
            }
          },
          next: {
            cid: subObjectCid,
            name: prop,
            path: subPath,
            toResolve
          }
        }
      }

      subObject = subObject[prop]
    } else {
      // cannot resolve further
      throw errCode(new Error(`No property named ${prop} found in cbor node ${cid}`), 'ERR_NO_PROP')
    }
  }

  return {
    entry: {
      type: 'object',
      name,
      path,
      cid,
      node: block.bytes,
      depth,
      size: block.length,
      content: async function * () {
        yield object
      }
    }
  }
}

module.exports = resolve
