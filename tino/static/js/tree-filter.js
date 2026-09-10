/** Recursively keep only nodes whose path matches the query. */

export const filterNodes = (nodes, query) => {
  if (!query)
    return nodes

  const result = []
  nodes.forEach(node => {
    if (node.type === 'directory') {
      const children = filterNodes(node.children, query)
      if (children.length) {
        result.push({
          children,
          name: node.name,
          path: node.path,
          status: node.status,
          type: node.type,
        })
      }
    } 
    else if (node.path.toLowerCase().includes(query))
      result.push(node)
  })
  return result
}
