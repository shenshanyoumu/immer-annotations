export {
    setAutoFreeze,
    setUseProxies,
    original,
    isProxy as isDraft
} from "./common"

import {applyPatches as applyPatchesImpl} from "./patches"
import {isProxy, isProxyable, getUseProxies, NOTHING} from "./common"
import {produceProxy} from "./proxy"
import {produceEs5} from "./es5"

/**
 * @param {any} baseState - 用于代理处理的原对象
 * @param {Function} producer - 该函数接收参数draft，表示baseState的代理对象，可以修改
 * @param {Function} patchListener - 可选参数，表示当对原对象的所有操作登记到patches对象中，然后处理的处理
 * @returns {any} 返回新对象，当没有任何修改时返回baseState
 */
export function produce(baseState, producer, patchListener) {
    // produce可以接收的参数数目范围
    if (arguments.length < 1 || arguments.length > 3) {
        throw new Error(
            "produce expects 1 to 3 arguments, got " + arguments.length
        )
    }

    // 科里化过程
    // 当第一个参数为函数，第二个参数要么为null或者非函数（一般为initialState）,则进行参数含义转换
    // 在redux库的applyMiddler函数中也采用了类似处理形式来接收可变类型参数
    if (typeof baseState === "function" && typeof producer !== "function") {
        const initialState = producer
        const recipe = baseState

        return function(currentState = initialState, ...args) {
            return produce(currentState, draft =>
                recipe.call(draft, draft, ...args)
            )
        }
    }

    {
        if (typeof producer !== "function")
            throw new Error(
                "if first argument is not a function, the second argument to produce should be a function"
            )
        if (patchListener !== undefined && typeof patchListener !== "function")
            throw new Error(
                "the third argument of a producer should not be set or a function"
            )
    }

    // 为了增强immer的应用场景，即使不可被代理的对象也可以执行开发者定义的producer函数
    if (!isProxyable(baseState)) {
        const returnValue = producer(baseState)
        return returnValue === undefined
            ? baseState
            : normalizeResult(returnValue)
    }

    //如果原对象已经被代理处理，则执行下面操作
    if (isProxy(baseState)) {
        const returnValue = producer.call(baseState, baseState)
        return returnValue === undefined
            ? baseState
            : normalizeResult(returnValue)
    }

    //如果原对象可被代理，并且还没有被代理，则调用代理生成函数
    return normalizeResult(
        getUseProxies()
            ? produceProxy(baseState, producer, patchListener)
            : produceEs5(baseState, producer, patchListener)
    )
}

//如果最终经过固化的对象是内置状态，则返回undefined
function normalizeResult(result) {
    return result === NOTHING ? undefined : result
}

export default produce

export const applyPatches = produce(applyPatchesImpl)

export const nothing = NOTHING
