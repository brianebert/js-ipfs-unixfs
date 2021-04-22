'use strict'

const { Bucket, createHAMT } = require('hamt-sharding')
const multihashing = require('multihashing-async')
// @ts-ignore
const { decode } = require('@ipld/dag-pb')

/**
 * @typedef {import('ipfs-unixfs-importer/src/types').BlockAPI} BlockService
 * @typedef {import('multiformats/cid').CID} CID
 * @typedef {import('../types').ExporterOptions} ExporterOptions
 * @typedef {import('@ipld/dag-pb').PBNode} PBNode
 * @typedef {import('@ipld/dag-pb').PBLink} PBLink
 */

// FIXME: this is copy/pasted from ipfs-unixfs-importer/src/dir-sharded.js
/**
 * @param {Uint8Array} buf
 */
const hashFn = async function (buf) {
  const hash = await multihashing(buf, 'murmur3-128')

  // Multihashing inserts preamble of 2 bytes. Remove it.
  // Also, murmur3 outputs 128 bit but, accidentally, IPFS Go's
  // implementation only uses the first 64, so we must do the same
  // for parity..
  const justHash = hash.slice(2, 10)
  const length = justHash.length
  const result = new Uint8Array(length)
  // TODO: invert buffer because that's how Go impl does it
  for (let i = 0; i < length; i++) {
    result[length - i - 1] = justHash[i]
  }

  return result
}

/**
 * @param {PBLink[]} links
 * @param {Bucket<boolean>} bucket
 * @param {Bucket<boolean>} rootBucket
 */
const addLinksToHamtBucket = (links, bucket, rootBucket) => {
  return Promise.all(
    links.map(link => {
      if (link.Name == null) {
        // TODO(@rvagg): what do? this is technically possible
        throw new Error('Unexpected Link without a Name')
      }
      if (link.Name.length === 2) {
        const pos = parseInt(link.Name, 16)

        return bucket._putObjectAt(pos, new Bucket({
          hash: rootBucket._options.hash,
          bits: rootBucket._options.bits
        }, bucket, pos))
      }

      return rootBucket.put(link.Name.substring(2), true)
    })
  )
}

/**
 * @param {number} position
 */
const toPrefix = (position) => {
  return position
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')
    .substring(0, 2)
}

/**
 * @param {import('hamt-sharding').Bucket.BucketPosition<boolean>} position
 */
const toBucketPath = (position) => {
  let bucket = position.bucket
  const path = []

  while (bucket._parent) {
    path.push(bucket)

    bucket = bucket._parent
  }

  path.push(bucket)

  return path.reverse()
}

/**
 * @typedef {object} ShardTraversalContext
 * @property {number} hamtDepth
 * @property {Bucket<boolean>} rootBucket
 * @property {Bucket<boolean>} lastBucket
 *
 * @param {PBNode} node
 * @param {string} name
 * @param {BlockService} blockService
 * @param {ShardTraversalContext} [context]
 * @param {ExporterOptions} [options]
 * @returns {Promise<CID|null>}
 */
const findShardCid = async (node, name, blockService, context, options) => {
  if (!context) {
    const rootBucket = createHAMT({
      hashFn
    })

    context = {
      rootBucket,
      hamtDepth: 1,
      lastBucket: rootBucket
    }
  }

  await addLinksToHamtBucket(node.Links, context.lastBucket, context.rootBucket)

  const position = await context.rootBucket._findNewBucketAndPos(name)
  let prefix = toPrefix(position.pos)
  const bucketPath = toBucketPath(position)

  if (bucketPath.length > context.hamtDepth) {
    context.lastBucket = bucketPath[context.hamtDepth]

    prefix = toPrefix(context.lastBucket._posAtParent)
  }

  const link = node.Links.find(link => {
    if (link.Name == null) {
      return false
    }

    const entryPrefix = link.Name.substring(0, 2)
    const entryName = link.Name.substring(2)

    if (entryPrefix !== prefix) {
      // not the entry or subshard we're looking for
      return false
    }

    if (entryName && entryName !== name) {
      // not the entry we're looking for
      return false
    }

    return true
  })

  if (!link) {
    return null
  }

  if (link.Name != null && link.Name.substring(2) === name) {
    return link.Hash
  }

  context.hamtDepth++

  const block = await blockService.get(link.Hash, options)
  node = decode(block.bytes)

  return findShardCid(node, name, blockService, context, options)
}

module.exports = findShardCid
