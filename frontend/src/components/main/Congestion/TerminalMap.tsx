
import { useEffect, useRef } from "react";
import * as THREE from "three";

import type {
  Hall,
  Terminal,
} from "../../../api/congestion";

import "./Terminal3D.css";

interface Props {
  terminal: Terminal;
  halls: Hall[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type Level = "LOW" | "MID" | "HIGH" | "UNKNOWN";

const COLORS: Record<Level, number> = {
  LOW: 0x7fd6bb,
  MID: 0xf5cd78,
  HIGH: 0xec7d80,
  UNKNOWN: 0xaab8ca,
};

const LABELS: Record<Level, string> = {
  LOW: "여유",
  MID: "보통",
  HIGH: "혼잡",
  UNKNOWN: "확인 필요",
};

const HEIGHTS: Record<Level, number> = {
  LOW: 1.0,
  MID: 2.2,
  HIGH: 4.0,
  UNKNOWN: 0.6,
};

function getLevel(hall?: Hall): Level {
  if (!hall || hall.operationStatus === "CHECK_REQUIRED") {
    return "UNKNOWN";
  }

  const value = String(hall.level ?? "")
    .trim()
    .toUpperCase();

  if (
    ["LOW", "RELAXED", "SPACIOUS", "FREE", "여유", "원활"]
      .includes(value)
  ) {
    return "LOW";
  }

  if (
    ["MID", "MEDIUM", "NORMAL", "MODERATE", "보통"]
      .includes(value)
  ) {
    return "MID";
  }

  if (
    ["HIGH", "BUSY", "CROWDED", "VERY_CROWDED", "혼잡", "매우혼잡"]
      .includes(value)
  ) {
    return "HIGH";
  }

  return "UNKNOWN";
}

function getHallNumber(hall: Hall): string | null {
  const name = String(hall.name ?? "");
  const id = String(hall.id ?? "");

  const match =
    name.match(/([1-6])\s*번?\s*출국장/) ??
    name.match(/출국장\s*([1-6])/) ??
    id.match(/^(?:H|HALL)?0*([1-6])$/i);

  return match?.[1] ?? null;
}

function findHall(halls: Hall[], number: string) {
  return halls.find(
    (hall) => getHallNumber(hall) === number
  );
}

function createArcShape(
  inner: number,
  outer: number,
  start: number,
  end: number
) {
  const shape = new THREE.Shape();
  const steps = 48;

  for (let i = 0; i <= steps; i++) {
    const angle = start + (end - start) * (i / steps);
    const x = Math.cos(angle) * outer;
    const y = Math.sin(angle) * outer;

    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }

  for (let i = steps; i >= 0; i--) {
    const angle = start + (end - start) * (i / steps);

    shape.lineTo(
      Math.cos(angle) * inner,
      Math.sin(angle) * inner
    );
  }

  shape.closePath();
  return shape;
}

function createArcMesh(
  inner: number,
  outer: number,
  start: number,
  end: number,
  height: number,
  color: number
) {
  const geometry = new THREE.ExtrudeGeometry(
    createArcShape(inner, outer, start, end),
    {
      depth: height,
      bevelEnabled: false,
      curveSegments: 48,
    }
  );

  // 원호 평면을 지면에 놓고 높이는 Y축으로 올림
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

interface LabelItem {
  element: HTMLButtonElement;
  position: THREE.Vector3;
}

export default function TerminalMap({
  terminal,
  halls,
  selectedId,
  onSelect,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();

    const camera = new THREE.OrthographicCamera(
      -30, 30, 20, -20, 0.1, 300
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.className = "terminal3d-canvas";
    mount.appendChild(renderer.domElement);

    // 조명
    scene.add(
      new THREE.HemisphereLight(
        0xffffff,
        0xd7e1ec,
        2
      )
    );

    const sun = new THREE.DirectionalLight(
      0xffffff,
      2
    );

    sun.position.set(-20, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);

    Object.assign(sun.shadow.camera, {
      left: -70,
      right: 70,
      top: 70,
      bottom: -70,
      near: 1,
      far: 150,
    });

    scene.add(sun);

    const group = new THREE.Group();
    scene.add(group);

    const isT1 = terminal === "T1";

    const numbers = isT1
      ? ["6", "5", "4", "3", "2", "1"]
      : ["2", "1"];

    const inner = isT1 ? 19 : 37;
    const outer = isT1 ? 28 : 46;

    const spread =
      (isT1 ? 55 : 34) * Math.PI / 180;

    const start = Math.PI / 2 - spread;
    const end = Math.PI / 2 + spread;
    const segment = (end - start) / numbers.length;

    // 건물 바닥
    const foundation = createArcMesh(
      inner - 1.2,
      outer + 1.2,
      start,
      end,
      0.45,
      0xe6eef7
    );

    foundation.position.y = -0.5;
    group.add(foundation);

    // 내부 통로
    const corridor = createArcMesh(
      inner + 0.2,
      inner + 2.0,
      start,
      end,
      0.2,
      0xffffff
    );

    group.add(corridor);

    // 지면 그림자
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 120),
      new THREE.ShadowMaterial({
        opacity: 0.12,
      })
    );

    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.7;
    ground.receiveShadow = true;

    scene.add(ground);

    const labels: LabelItem[] = [];

    numbers.forEach((number, index) => {
      const hall = findHall(halls, number);
      const level = getLevel(hall);
      const height = HEIGHTS[level];

      const a0 = start + segment * index + 0.006;
      const a1 = start + segment * (index + 1) - 0.006;

      const mesh = createArcMesh(
        inner + 2.5,
        outer - 0.6,
        a0,
        a1,
        height,
        COLORS[level]
      );

      if (hall && selectedId === hall.id) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissive.setHex(0x174c99);
        material.emissiveIntensity = 0.16;
      }

      group.add(mesh);

      // 건물 구역의 실제 3D 좌표와 라벨 좌표 일치
      const angle = (a0 + a1) / 2;
      const radius = (inner + outer) / 2;

      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        height + 0.6,
        -Math.sin(angle) * radius
      );

      const label = document.createElement("button");
      label.type = "button";
      label.className = `terminal3d-label is-${level.toLowerCase()}`;

      if (hall && selectedId === hall.id) {
        label.classList.add("is-selected");
      }

      const title = document.createElement("strong");
      title.textContent = `${number}번 출국장`;

      const status = document.createElement("span");
      status.textContent =
        hall?.operationStatus === "CHECK_REQUIRED"
          ? "운영 확인 필요"
          : LABELS[level];

      label.append(title, status);
      label.disabled = !hall;

      if (hall) {
        label.addEventListener("click", () => {
          onSelect(hall.id);
        });
      }

      mount.appendChild(label);
      labels.push({ element: label, position });
    });

    // 카메라가 바라볼 건물 중심을 자동 계산
    group.updateWorldMatrix(true, true);

    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());

    camera.position.copy(center).add(
      new THREE.Vector3(-17, 38, 35)
    );

    camera.lookAt(center);
    camera.updateMatrixWorld(true);

    function renderScene() {
      const width = mountRef.current?.clientWidth ?? 0;
      const height = mountRef.current?.clientHeight ?? 0;

      if (width <= 0 || height <= 0) return;

      const aspect = width / height;

      // 건물의 화면상 가로/세로 크기를 계산
      const right = new THREE.Vector3()
        .setFromMatrixColumn(camera.matrixWorld, 0);

      const up = new THREE.Vector3()
        .setFromMatrixColumn(camera.matrixWorld, 1);

      const corners = [
        new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
        new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
        new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
        new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
        new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
        new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
        new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
        new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      ];

      let halfWidth = 0;
      let halfHeight = 0;

      for (const corner of corners) {
        const relative = corner.clone().sub(center);

        halfWidth = Math.max(
          halfWidth,
          Math.abs(relative.dot(right))
        );

        halfHeight = Math.max(
          halfHeight,
          Math.abs(relative.dot(up))
        );
      }

      // 건물에 약간의 여백을 남겨 화면에 맞춤
      const fittedHeight = Math.max(
        halfHeight * 1.65,
        (halfWidth * 1.3) / aspect,
        7
      );

      camera.left = -fittedHeight * aspect;
      camera.right = fittedHeight * aspect;
      camera.top = fittedHeight;
      camera.bottom = -fittedHeight;

      camera.updateProjectionMatrix();

      renderer.setSize(width, height, false);
      renderer.render(scene, camera);

      // 3D 구역 위 라벨 배치
      const positioned = labels.map((item) => {
        const point = item.position.clone().project(camera);

        return {
          ...item,
          x: ((point.x + 1) / 2) * width,
          y: ((1 - point.y) / 2) * height,
          visible: Math.abs(point.x) <= 1.1 &&
                   Math.abs(point.y) <= 1.1,
        };
      });

      // 가로 라벨끼리 겹치지 않도록 간격 확보
      const sorted = [...positioned].sort((a, b) => a.x - b.x);
      const gap = isT1 ? 64 : 80;
      const padding = 30;

      let previousX = padding - gap;

      sorted.forEach((item) => {
        if (!item.visible) {
          item.element.hidden = true;
          return;
        }

        const x = Math.max(item.x, previousX + gap);
        previousX = x;

        item.element.hidden = false;
        item.element.style.left = `${x}px`;
        item.element.style.top = `${item.y}px`;
      });

      // 오른쪽으로 밀린 라벨을 화면 안에 보정
      const visible = sorted.filter((item) => item.visible);
      const last = visible[visible.length - 1];

      if (last) {
        const lastX = parseFloat(last.element.style.left);
        const overflow = lastX - (width - padding);

        if (overflow > 0) {
          visible.forEach((item) => {
            const x = parseFloat(item.element.style.left);
            item.element.style.left = `${x - overflow}px`;
          });
        }
      }
    }

    const observer = new ResizeObserver(renderScene);
    observer.observe(mount);

    renderScene();

    return () => {
      observer.disconnect();

      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;

        object.geometry.dispose();

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach((material) => {
          material.dispose();
        });
      });

      renderer.dispose();
      renderer.domElement.remove();

      labels.forEach(({ element }) => {
        element.remove();
      });
    };
  }, [terminal, halls, selectedId, onSelect]);

  return (
    <div className="terminal3d">
      <div
        ref={mountRef}
        className="terminal3d-stage"
        aria-label={`${terminal} 출국장 3D 혼잡도`}
      />

      <div className="terminal3d-footer">
        <span>{terminal} · 3F 출발층</span>
        <span>입체형 터미널 개략도</span>
      </div>
    </div>
  );
}
