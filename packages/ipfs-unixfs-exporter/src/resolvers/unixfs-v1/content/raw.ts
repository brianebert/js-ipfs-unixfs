import type { ExporterOptions, UnixfsV1Resolver } from '../../../index.js'
import extractDataFromBlock from '../../../utils/extract-data-from-block.js'
import validateOffsetAndLength from '../../../utils/validate-offset-and-length.js'

const rawContent: UnixfsV1Resolver = (cid, node, unixfs, path, resolve, depth, blockstore) => {
  function * yieldRawContent (options: ExporterOptions = {}): Generator<Uint8Array, void, undefined> {
    if (unixfs.data == null) {
      throw new Error('Raw block had no data')
    }

    const size = unixfs.data.length

    const {
      offset,
      length
    } = validateOffsetAndLength(size, options.offset, options.length)

    yield extractDataFromBlock(unixfs.data, 0n, offset, offset + length)
  }

  return yieldRawContent
}

export default rawContent