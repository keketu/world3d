// 合并零件：展开索引并带上法线/顶点色，合成一个几何体，之后只用一个材质绘制
// 保留各零件原有的明暗（盒子硬边、球面平滑）——不同于 props.ts 的 paintAndMerge（按位置焊接，会把棱角抹圆）
import * as THREE from "three";

export type Parts = THREE.Mesh[];

export function mergeParts(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  let count = 0;
  for (const m of meshes) count += m.geometry.getIndex()?.count ?? m.geometry.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let o = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const pa = g.getAttribute("position");
    const na = g.getAttribute("normal");
    const idx = g.getIndex();
    const c = (m.material as THREE.MeshLambertMaterial).color;
    m.updateMatrix();
    nm.getNormalMatrix(m.matrix);
    const cnt = idx ? idx.count : pa.count;
    for (let i = 0; i < cnt; i++) {
      const vi = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(pa, vi).applyMatrix4(m.matrix);
      nv.fromBufferAttribute(na, vi).applyMatrix3(nm).normalize();
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      nor[o] = nv.x; nor[o + 1] = nv.y; nor[o + 2] = nv.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      o += 3;
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}
