"use strict"
// @ts-check

import {
    assign,
    each,
    has,
    is,
    isProxyable,
    isProxy,
    finalize,
    shallowCopy,
    PROXY_STATE,
    RETURNED_AND_MODIFIED_ERROR
} from "./common"

// 用于存储运算中所有proxy实例的数组
let proxies = null

// 类似proxy的handler函数，对下面方法进行了拦截处理
const objectTraps = {
    get,
    has(target, prop) {
        return prop in source(target)
    },
    ownKeys(target) {
        return Reflect.ownKeys(source(target))
    },
    set,
    deleteProperty,
    getOwnPropertyDescriptor,
    defineProperty,
    setPrototypeOf() {
        throw new Error("Immer does not support `setPrototypeOf()`.")
    }
}

// 对于数组对象的每个对象元素进行遍历访问代理
const arrayTraps = {}
each(objectTraps, (key, fn) => {
    arrayTraps[key] = function() {
        arguments[0] = arguments[0][0]
        return fn.apply(this, arguments)
    }
})

//
arrayTraps.deleteProperty = function(state, prop) {
    if (isNaN(parseInt(prop)))
        throw new Error(
            "Immer does not support deleting properties from arrays: " + prop
        )
    return objectTraps.deleteProperty.call(this, state[0], prop)
}
arrayTraps.set = function(state, prop, value) {
    if (prop !== "length" && isNaN(parseInt(prop)))
        throw new Error(
            "Immer does not support setting non-numeric properties on arrays: " +
                prop
        )
    return objectTraps.set.call(this, state[0], prop, value)
}

// 参数base是真正传递给immer处理的对象，比如redux库中reducer处理的state对象
function createState(parent, base) {
    return {
        modified: false, //判断当前JS对象树是否发生过修改操作
        assigned: {}, //在操作过程中，当对原对象的属性进行赋值则记录为XX:true形式；没有进行操作的属性记录为yy:false
        finalized: false,
        parent,
        base,
        copy: undefined,
        proxies: {}
    }
}

/**
 * 根据state的modified来决定是否返回原对象还是copy值
 * @param {*} state 被代理的对象在immer中进行了属性扩展
 */
function source(state) {
    return state.modified === true ? state.copy : state.base
}

// 根据给定属性返回对应属性值
function get(state, prop) {
    if (prop === PROXY_STATE) {
        return state
    }

    // 当state对象已经发生了修改，则
    if (state.modified) {
        const value = state.copy[prop]

        // 每当访问某个状态发生修改的对象属性，则需要增加代理层防止意外访问
        if (value === state.base[prop] && isProxyable(value))
            return (state.copy[prop] = createProxy(state, value))
        return value
    } else {
        // 如果对象中某个属性对象已经创建了代理，则直接从proxies数组中返回即可
        if (has(state.proxies, prop)) {
            return state.proxies[prop]
        }
        const value = state.base[prop]
        // 没有被代理的可代理属性访问，同样需要创建对该属性访问的代理
        if (!isProxy(value) && isProxyable(value))
            return (state.proxies[prop] = createProxy(state, value))
        return value
    }
}

// 根据属性名和属性值设置给定的state对象
function set(state, prop, value) {
    if (!state.modified) {
        // 判定赋值操作是否并没有修改内容，对于没有发生任何变化的赋值直接返回true
        const isUnchanged = value
            ? is(state.base[prop], value) || value === state.proxies[prop]
            : is(state.base[prop], value) && prop in state.base
        if (isUnchanged) return true
        markChanged(state)
    }

    // 当真正发生了赋值处理，则修改下面状态
    state.assigned[prop] = true
    state.copy[prop] = value
    return true
}

// 删除某个属性，则将代理对象的assigned属性对象中prop属性设置为false
// 并删除代理对象copy属性对象的prop属性
function deleteProperty(state, prop) {
    state.assigned[prop] = false
    markChanged(state)
    delete state.copy[prop]
    return true
}

// 根据给定的对象及prop属性名，得到该属性的描述符信息
function getOwnPropertyDescriptor(state, prop) {
    const owner = state.modified
        ? state.copy
        : has(state.proxies, prop)
        ? state.proxies
        : state.base
    const descriptor = Reflect.getOwnPropertyDescriptor(owner, prop)
    if (descriptor && !(Array.isArray(owner) && prop === "length"))
        descriptor.configurable = true
    return descriptor
}

// 代理对象就是draft
function defineProperty() {
    throw new Error(
        "Immer does not support defining properties on draft objects."
    )
}

// 当前的对象树设置modified标记，并且递归向上使得整个完整的对象树的modified状态得到设置
function markChanged(state) {
    if (!state.modified) {
        state.modified = true
        state.copy = shallowCopy(state.base)

        assign(state.copy, state.proxies)
        if (state.parent) {
            markChanged(state.parent)
        }
    }
}

// base为真正进行代理操作的对象，而parentState表示该对象在对象树结构中还具有父级节点，用于遍历整个对象树
function createProxy(parentState, base) {
    // 如果原对象已经被代理，则抛出错误
    if (isProxy(base)) {
        throw new Error("Immer bug. Plz report.")
    }
    const state = createState(parentState, base)

    //Proxy.revocable返回一个可取消的Proxy代理；当执行Proxy实例的revoke函数，则该代理对象被垃圾回收处理
    const proxy = Array.isArray(base)
        ? Proxy.revocable([state], arrayTraps)
        : Proxy.revocable(state, objectTraps)

    // 将所有生成的代理对象存储在proxies数组中
    proxies.push(proxy)
    return proxy.proxy
}

// 参数patchListenr针对patches对象应用到对原对象的draft修改
export function produceProxy(baseState, producer, patchListener) {
    const previousProxies = proxies
    proxies = []
    const patches = patchListener && []
    const inversePatches = patchListener && []
    try {
        // 对对象树顶层状态访问创建代理
        const rootProxy = createProxy(undefined, baseState)
        // 在真实操作中，访问对象树第一层属性时产生的结果
        const returnValue = producer.call(rootProxy, rootProxy)

        let result

        if (returnValue !== undefined && returnValue !== rootProxy) {
            if (rootProxy[PROXY_STATE].modified)
                throw new Error(RETURNED_AND_MODIFIED_ERROR)

            // 对对象树第一次属性的访问修改进行固化处理，并登记patches日志
            result = finalize(returnValue)
            if (patches) {
                patches.push({op: "replace", path: [], value: result})
                inversePatches.push({op: "replace", path: [], value: baseState})
            }
        } else {
            result = finalize(rootProxy, [], patches, inversePatches)
        }
        // 代理对象调用revoke将会处理垃圾回收
        each(proxies, (_, p) => p.revoke())
        patchListener && patchListener(patches, inversePatches)
        return result
    } finally {
        proxies = previousProxies
    }
}
