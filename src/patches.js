import {each} from "./common"

// 针对原对象的每一步操作都会保存在patches对象中，
export function generatePatches(
    state,
    basepath,
    patches,
    inversePatches,
    baseValue,
    resultValue
) {
    // 对原对象的修改操作都暂存在patches对象中，可以理解为数据库中的操作日志
    if (patches)
        if (Array.isArray(baseValue))
            generateArrayPatches(
                state,
                basepath,
                patches,
                inversePatches,
                baseValue,
                resultValue
            )
        else
            generateObjectPatches(
                state,
                basepath,
                patches,
                inversePatches,
                baseValue,
                resultValue
            )
}

// 参数state包含了原对象，以及一系列操作相关的属性
export function generateArrayPatches(
    state,
    basepath,
    patches,
    inversePatches,
    baseValue,
    resultValue
) {
    // 突然联想到了D3可视化库中，数据集与DOM集绑定过程中的update/enter/exit三种操作形式

    // 对比新旧数组长度，得到最短的长度。这个长度内的元素发生了修改处理
    const shared = Math.min(baseValue.length, resultValue.length)
    for (let i = 0; i < shared; i++) {
        // 对于属性的修改操作，则进行下面处理
        if (state.assigned[i] && baseValue[i] !== resultValue[i]) {
            const path = basepath.concat(i)
            patches.push({op: "replace", path, value: resultValue[i]})
            inversePatches.push({op: "replace", path, value: baseValue[i]})
        }
    }
    if (shared < resultValue.length) {
        // 对于目标数组长度大于shared，表示新增了元素。将新增元素的索引保存到patches对象中
        for (let i = shared; i < resultValue.length; i++) {
            const path = basepath.concat(i)
            patches.push({op: "add", path, value: resultValue[i]})
        }
        inversePatches.push({
            op: "replace",
            path: basepath.concat("length"), //通过在属性路径添加length字符串来区分
            value: baseValue.length
        })
    } else if (shared < baseValue.length) {
        // 当目标数组长度小于原数组，则发生了删除操作
        patches.push({
            op: "replace",
            path: basepath.concat("length"),
            value: resultValue.length
        })
        for (let i = shared; i < baseValue.length; i++) {
            const path = basepath.concat(i)
            inversePatches.push({op: "add", path, value: baseValue[i]})
        }
    }
}

function generateObjectPatches(
    state,
    basepath,
    patches,
    inversePatches,
    baseValue,
    resultValue
) {
    // state.assigned属性对象保存一系列临时的赋值操作
    // 当assigned中存在的属性名不在原对象中，则表示“add"操作
    // 当assigned中某个属性值为null，则说明该属性需要被”remove“操作
    // 当assigned中的属性名存在于原对象中，表示”replace“操作
    each(state.assigned, (key, assignedValue) => {
        const origValue = baseValue[key]
        const value = resultValue[key]
        const op = !assignedValue
            ? "remove"
            : key in baseValue
            ? "replace"
            : "add"

        // 虽然patches记录的操作是replace，但是对于存在自递归的对象不要进行下面操作不然会无限循环
        if (origValue === baseValue && op === "replace") {
            return
        }
        const path = basepath.concat(key)
        patches.push(op === "remove" ? {op, path} : {op, path, value})
        inversePatches.push(
            op === "add"
                ? {op: "remove", path}
                : op === "remove"
                ? {op: "add", path, value: origValue}
                : {op: "replace", path, value: origValue}
        )
    })
}

// 将对currentState的所有修改先保存在patches对象中，然后根据patches来修改draft，因此可知下面函数有副作用
export function applyPatches(draft, patches) {
    for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]

        // 对象的路径，就是对多层结构对象特定属性的访问路径。
        // 类似immutable中['a','b']表示对象a属性对象下的b属性
        const {path} = patch

        // 根据patch的操作修改draft
        if (path.length === 0 && patch.op === "replace") {
            draft = patch.value
        } else {
            let base = draft
            for (let i = 0; i < path.length - 1; i++) {
                // base对象根据path路径数组，迭代访问直到访问真正修改的属性
                base = base[path[i]]
                if (!base || typeof base !== "object")
                    throw new Error(
                        "Cannot apply patch, path doesn't resolve: " +
                            path.join("/")
                    )
            }

            //对象最里层需要修改的属性的key
            const key = path[path.length - 1]
            switch (patch.op) {
                case "replace":
                case "add":
                    // TODO: add support is not extensive, it does not support insertion or `-` atm!
                    base[key] = patch.value
                    break
                case "remove":
                    if (Array.isArray(base)) {
                        if (key === base.length - 1) base.length -= 1
                        else
                            throw new Error(
                                `Remove can only remove the last key of an array, index: ${key}, length: ${
                                    base.length
                                }`
                            )
                    } else delete base[key]
                    break
                default:
                    throw new Error("Unsupported patch operation: " + patch.op)
            }
        }
    }
    return draft
}
