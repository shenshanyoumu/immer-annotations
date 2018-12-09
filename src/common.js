import {generatePatches} from "./patches"

// ES6才有Symbol特性，之前版本采用普通对象属性方式
export const NOTHING =
    typeof Symbol !== "undefined"
        ? Symbol("immer-nothing")
        : {["immer-nothing"]: true}

// immer的实现机制就是基于对象属性访问拦截代理，在ES6使用Proxy对象，之前版本使用defineProperty
export const PROXY_STATE =
    typeof Symbol !== "undefined"
        ? Symbol("immer-proxy-state")
        : "__$immer_state"

// immer生成新的状态对象并不需要开发者显式返回
export const RETURNED_AND_MODIFIED_ERROR =
    "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft."

function verifyMinified() {}

// 判断当前打包是否生产环境
const inProduction =
    (typeof process !== "undefined" && process.env.NODE_ENV === "production") ||
    verifyMinified.name !== "verifyMinified"

let autoFreeze = !inProduction

// 当前运行环境是否原生实现Proxy/Reflect特性
let useProxies = typeof Proxy !== "undefined" && typeof Reflect !== "undefined"

// 对状态树的冻结处理，防止在immer之外修改状态对象。
// 这种操作一般在开发环境中调试，而生产环境为了性能考虑可以不进行冻结处理
export function setAutoFreeze(enableAutoFreeze) {
    autoFreeze = enableAutoFreeze
}

// 根据用户环境可以自定义代理对象数组
export function setUseProxies(value) {
    useProxies = value
}

// 返回当前环境的代理对象数组;
// 所谓代理对象数组是因为对于整个对象树中所有非叶子节点的访问都需要创建新的代理,而无法通过单一的代理对象来访问深层的属性
export function getUseProxies() {
    return useProxies
}

// 具有[PROXY_STATE]属性的对象表示代理对象
export function isProxy(value) {
    return !!value && !!value[PROXY_STATE]
}

//  判断给定参数value是否可以被代理，只有普通对象和数组对象的属性访问可以被代理
export function isProxyable(value) {
    if (!value) return false
    if (typeof value !== "object") {
        return false
    }
    if (Array.isArray(value)) return true
    const proto = Object.getPrototypeOf(value)
    return proto === null || proto === Object.prototype
}

// 处理是否冻结对象修改，在开发环境中设置冻结操作，则可以检测immer之外对状态的修改并warning
// 在生产环境中，为了性能考虑就可以避免冻结操作
export function freeze(value) {
    if (autoFreeze) {
        Object.freeze(value)
    }
    return value
}

// 得到代理对象的原对象
export function original(value) {
    if (value && value[PROXY_STATE]) {
        return value[PROXY_STATE].base
    }
    // otherwise return undefined
}

export const assign =
    Object.assign ||
    function assign(target, value) {
        // for...in会遍历对象及其原型链上可枚举属性，因此需要进一步处理只操作对象自身枚举属性
        for (let key in value) {
            if (has(value, key)) {
                target[key] = value[key]
            }
        }
        return target
    }

// 浅拷贝
export function shallowCopy(value) {
    if (Array.isArray(value)) return value.slice()
    const target = value.__proto__ === undefined ? Object.create(null) : {}
    return assign(target, value)
}

// 遍历value对象每个元素/属性，并进行回调处理
export function each(value, cb) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) cb(i, value[i])
    } else {
        for (let key in value) cb(key, value[key])
    }
}

// 判定prop是否为thing对象自身属性
export function has(thing, prop) {
    return Object.prototype.hasOwnProperty.call(thing, prop)
}

// 从draft状态到nextState的处理逻辑
export function finalize(base, path, patches, inversePatches) {
    if (isProxy(base)) {
        const state = base[PROXY_STATE]

        // 类似patches回放，当currentState某个属性发生修改，先记录在patch中
        if (state.modified === true) {
            // 当patch对象已经完成所有修改操作，则返回patch对象
            if (state.finalized === true) return state.copy
            state.finalized = true
            const result = finalizeObject(
                useProxies ? state.copy : (state.copy = shallowCopy(base)),
                state,
                path,
                patches,
                inversePatches
            )
            generatePatches(
                state,
                path,
                patches,
                inversePatches,
                state.base,
                result
            )
            return result
        } else {
            // 如果没有任何修改操作，则直接返回原对象，这就是一种称为copy-on-write的结构共享的方式
            return state.base
        }
    }
    finalizeNonProxiedObject(base)
    return base
}

function finalizeObject(copy, state, path, patches, inversePatches) {
    // 原对象
    const base = state.base
    each(copy, (prop, value) => {
        if (value !== base[prop]) {
            // 如果state对象存在assigned属性对象，且该属性对象具有prop属性则不产生patches
            const generatePatches = patches && !has(state.assigned, prop)

            // 递归进行处理，参数inversePatches主要用于回放操作
            copy[prop] = finalize(
                value,
                generatePatches && path.concat(prop),
                generatePatches && patches,
                inversePatches
            )
        }
    })

    // 判定是否冻结修改后的对象
    return freeze(copy)
}

// 对没有被代理的对象的修改操作
function finalizeNonProxiedObject(parent) {
    // 判定parent对象是否可被代理，所谓可被代理即对象parent要么是数组要么是普通对象
    if (!isProxyable(parent)) return

    // 对象被冻结，则无法进行修改直接返回
    if (Object.isFrozen(parent)) return

    // 遍历parent对象属性或者数组元素
    each(parent, (i, child) => {
        // 如果属性被代理，则处理；否则继续递归调用
        if (isProxy(child)) {
            parent[i] = finalize(child)
        } else finalizeNonProxiedObject(child)
    })
}

// 判定参数x/y绝对相等。即对于对象类型引用地址一样；而对于基础类型则值严格相等
export function is(x, y) {
    if (x === y) {
        return x !== 0 || 1 / x === 1 / y
    } else {
        // 下面怪异判断的含义就在于x/y可能是代理对象，隐式地进行了属性访问拦截
        return x !== x && y !== y
    }
}
