/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from './helpers'

const WKCS_ADDRESS = '0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521'
const USDC_WKCS_PAIR = '0xc2CACD273630bc1dcb1C7Ca398374896Fa1D6322' // created block -
const BUSD_WKCS_PAIR = '0x26d94a2E3BD703847C3BE3C30eAd42b926B427c2'  // created block -
const USDT_WKCS_PAIR = '0x1116b80FD0Ff9A980DCfBFa3ed477BFA6bBD6a85' // created block -

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdtPair = Pair.load(USDT_WKCS_PAIR) // usdt is token0
  let usdcPair = Pair.load(USDC_WKCS_PAIR) // busd is token1
  let busdPair = Pair.load(BUSD_WKCS_PAIR)   // busd is token0

  // all 3 have been created
  if (busdPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityKCS = busdPair.reserve1.plus(usdcPair.reserve0).plus(usdtPair.reserve1)
    let busdWeight = busdPair.reserve1.div(totalLiquidityKCS)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityKCS)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityKCS)
    return busdPair.token0Price
      .times(busdWeight)
      .plus(usdcPair.token1Price.times(usdcWeight))
      .plus(usdtPair.token0Price.times(usdtWeight))
    // busd and usdt have been created
  } else if (usdcPair !== null && usdtPair !== null) {
    let totalLiquidityKCS = usdcPair.reserve0.plus(usdtPair.reserve1)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityKCS)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityKCS)
    return usdcPair.token1Price.times(usdcWeight).plus(usdtPair.token0Price.times(usdtWeight))
    // usdt is the only pair so far
  } else if (usdtPair !== null) {
    return usdtPair.token0Price
  } else if (usdcPair !== null) {
    return usdcPair.token1Price
  }
  //   else {
  //   return ZERO_BD
  // }
  else {
    return ONE_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521', // WKCS
  '0x0039f574ee5cc39bdd162e9a88e3eb1f111baf48', // USDT
  '0x980a5afef3d17ad98635f6c5aebcbaeded3c3430', // USDC
  '0x755d74d009f656ca1652cbdc135e3b6abfccc455', // KSF
  '0x639a647fbe20b6c8ac19e48e2de44ea792c62c5c', // BNB
  '0xe3f5a90f9cb311505cd691a46596599aa1a0ad7d', // BUSD
  '0xf55af137a98607f7ed2efefa4cd2dfe70e4253b1', // ETH
  '0x218c3c3d49d0e7b37aff0d8bb079de36ae61a4c0', // BTC
  '0xc9baa8cfdde8e328787e29b4b078abf2dadc2055', // DAI
  '0x904257e308ed31144a743beb7b46f304f4a7a79e', // RS
]

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WKCS_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
