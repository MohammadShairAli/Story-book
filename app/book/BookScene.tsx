"use client";

/* eslint-disable react-hooks/immutability -- The three.js objects here
   (camera, mixer, animation action, materials, button nodes) are external
   mutable scene state. They are only changed in effects, pointer handlers
   and the frame loop, never during render, which is the model React Three
   Fiber is built around. */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { soundForTexture, type SoundId } from "./sounds";
import { CLIP_NAME, MODEL_PATH, STOPS, clampStop, turnRate } from "./timeline";

/** The book is rescaled so its widest pose measures this across. */
const BOOK_WIDTH = 2.6;

/** Breathing room left around the book, as a fraction of the usable frame. */
const MARGIN = 1.06;

/**
 * Screen space kept clear for the overlaid header and control bar, so the
 * book is framed in the area between them rather than underneath them.
 */
const SAFE_TOP_PX = 96;
const SAFE_BOTTOM_PX = 172;

/** Materials that should read as paper rather than as a coated surface. */
const PAPER = new Set(["1", "2", "3", "4", "5", "6", "White"]);

/** Poses sampled when measuring how much room the animation needs. */
const POSE_SAMPLES = 15;

/** How far a sound button travels when pressed, in model units (metres). */
const PRESS_DEPTH = 0.0024;
const PRESS_HOLD_MS = 130;

/** Where the book should sit horizontally at a clip time, eased between stops. */
function centreAt(time: number, centres: readonly number[]) {
  if (time <= STOPS[0]) return centres[0];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (time <= STOPS[i + 1]) {
      const t = (time - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
      return THREE.MathUtils.lerp(centres[i], centres[i + 1], t * t * (3 - 2 * t));
    }
  }
  return centres[centres.length - 1];
}

type SoundButton = {
  id: SoundId;
  node: THREE.Object3D;
  caps: THREE.MeshStandardMaterial[];
  restY: number;
  pressedAt: number;
  press: number;
};

/**
 * Grows `box` to cover every vertex of `subject` in its current pose.
 * Skinned vertices are transformed on the CPU, because a skinned mesh's
 * cached bounds only ever describe its bind pose.
 */
function expandByPose(box: THREE.Box3, subject: THREE.Object3D, stride: number) {
  const vertex = new THREE.Vector3();

  subject.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!position) return;

    const skinned = mesh as unknown as THREE.SkinnedMesh;
    const isSkinned = skinned.isSkinnedMesh === true;
    const step = isSkinned ? stride : Math.max(stride * 8, 8);

    for (let i = 0; i < position.count; i += step) {
      vertex.fromBufferAttribute(position, i);
      if (isSkinned) skinned.applyBoneTransform(i, vertex);
      box.expandByPoint(vertex.applyMatrix4(mesh.matrixWorld));
    }
  });
}

/**
 * Distance along `direction` at which every corner lands inside the frame.
 * Solved numerically so it holds for any camera angle and aspect ratio.
 * `usableHeight` is the fraction of the frame's half-height left free of UI.
 */
function fitDistance(
  camera: THREE.PerspectiveCamera,
  corners: THREE.Vector3[],
  target: THREE.Vector3,
  direction: THREE.Vector3,
  margin: number,
  usableHeight: number,
) {
  const projected = new THREE.Vector3();
  let distance = 12;

  for (let pass = 0; pass < 10; pass++) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    let extent = 0;
    for (const corner of corners) {
      projected.copy(corner).project(camera);
      extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y) / usableHeight);
    }

    if (!Number.isFinite(extent) || extent <= 0) break;
    const next = distance * extent * margin;
    const settled = Math.abs(next - distance) < 0.001;
    distance = next;
    if (settled) break;
  }

  return distance;
}

function BookModel({
  stop,
  onSettled,
  onButton,
}: {
  stop: number;
  onSettled: () => void;
  onButton?: (id: SoundId) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(MODEL_PATH);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & {
        target: THREE.Vector3;
        update: () => void;
        minDistance: number;
        maxDistance: number;
      })
    | null;

  /**
   * The mixer is rooted on the loaded scene rather than on a ref, so the
   * action exists from the very first render. (drei's `useAnimations`
   * hands back `actions` as a lazy getter that yields `undefined` until
   * its ref attaches -- easy to capture once and never re-read.)
   */
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);

  /* --------------------------------------------------------------- *
   * The six pressable buttons on the sound module, found by the decal
   * printed on each cap.
   * --------------------------------------------------------------- */
  const buttons = useMemo(() => {
    const list: SoundButton[] = [];

    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cap = materials.find((material) =>
        soundForTexture((material as THREE.MeshStandardMaterial).map?.name),
      ) as THREE.MeshStandardMaterial | undefined;
      if (!cap) return;

      // A multi-material node loads as a group of meshes; press the group.
      const node = mesh.parent && mesh.parent !== scene ? mesh.parent : mesh;
      let button = list.find((candidate) => candidate.node === node);
      if (!button) {
        button = {
          id: soundForTexture(cap.map?.name)!,
          node,
          caps: [],
          restY: node.position.y,
          pressedAt: -Infinity,
          press: 0,
        };
        list.push(button);
      }
      button.caps.push(cap);
    });

    const byObject = new Map<THREE.Object3D, SoundButton>();
    for (const button of list) button.node.traverse((child) => byObject.set(child, button));

    return { list, byObject };
  }, [scene]);

  /* --------------------------------------------------------------- *
   * Material + texture pass.
   *
   * Two things in the export fight a clean render: the page materials
   * carry ~0.15 metalness, so every surface with nothing to reflect goes
   * black, and textures arrive with anisotropy 1, which smears the print
   * as soon as a page tilts away from the camera.
   * --------------------------------------------------------------- */
  useLayoutEffect(() => {
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const seen = new Set<THREE.Texture>();

    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned meshes are culled against their bind-pose bounds, so a
      // leaf standing upright mid-turn would otherwise pop out of view.
      mesh.frustumCulled = false;
      // Only the buttons take pointer input. Skipping everything else keeps
      // hover checks from CPU-skinning 17k page vertices on every move.
      if (!buttons.byObject.has(mesh)) mesh.raycast = () => {};

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) continue;

        if (PAPER.has(standard.name)) {
          standard.metalness = 0;
          standard.roughness = 0.66;
        } else {
          standard.metalness = Math.min(standard.metalness, 0.28);
          standard.roughness = Math.max(standard.roughness, 0.3);
        }
        standard.envMapIntensity = 0.9;

        if (standard.map && !seen.has(standard.map)) {
          seen.add(standard.map);
          standard.map.anisotropy = anisotropy;
          standard.map.minFilter = THREE.LinearMipmapLinearFilter;
          standard.map.magFilter = THREE.LinearFilter;
          standard.map.needsUpdate = true;
        }
        standard.needsUpdate = true;
      }
    });
  }, [buttons, gl, scene]);

  const action = useMemo(() => {
    const clip = animations.find((candidate) => candidate.name === CLIP_NAME) ?? animations[0];
    if (!clip) return null;

    const next = mixer.clipAction(clip);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.play();
    next.paused = true; // the time is driven by hand, in useFrame
    next.time = STOPS[0];
    return next;
  }, [animations, mixer]);

  /* --------------------------------------------------------------- *
   * Measure the room the book needs across the whole animation, once.
   *
   * Framing against this fixed box -- rather than re-fitting per frame --
   * is what keeps the book a constant size on screen. An open book is
   * roughly twice as wide as a closed one, and re-fitting would visibly
   * shrink it the moment the cover lifted.
   * --------------------------------------------------------------- */
  const fit = useMemo(() => {
    const settled = new THREE.Box3();
    const swept = new THREE.Box3();
    const duration = STOPS[STOPS.length - 1];
    const restore = action?.time ?? 0;

    const sample = (time: number, box: THREE.Box3) => {
      if (action) action.time = time;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      expandByPose(box, scene, 2);
    };

    // Where the book comes to rest ...
    const restingCentres: number[] = [];
    for (const time of STOPS) {
      const pose = new THREE.Box3();
      sample(time, pose);
      restingCentres.push(pose.getCenter(new THREE.Vector3()).x);
      settled.union(pose);
    }
    // ... and everywhere it passes through on the way.
    for (let i = 0; i <= POSE_SAMPLES; i++) sample((i / POSE_SAMPLES) * duration, swept);
    swept.union(settled);

    if (action) action.time = restore;
    mixer.update(0);

    /*
     * Framing the full swept volume would reserve permanent headroom for a
     * leaf that is only upright for a moment, leaving the book small for
     * the rest of the time. Width has to clear -- a spread running off the
     * side reads as broken -- but a page may crest slightly past the top.
     */
    const rest = settled.getSize(new THREE.Vector3());
    const sweep = swept.getSize(new THREE.Vector3());
    const extent = new THREE.Vector3(sweep.x, THREE.MathUtils.lerp(rest.y, sweep.y, 0.42), sweep.z);

    const centre = settled.getCenter(new THREE.Vector3());
    centre.y = swept.min.y + extent.y / 2;

    const scale = BOOK_WIDTH / Math.max(extent.x, extent.z, 0.001);

    return {
      scale,
      offset: centre.clone().multiplyScalar(-1),
      half: extent.multiplyScalar(scale / 2),
      floor: (swept.min.y - centre.y) * scale,
      /*
       * Each resting pose, relative to the frame. A shut book only fills the
       * right half of the space an open one needs, so it is slid across to
       * stay centred, gliding as pages turn.
       */
      centres: restingCentres.map((x) => (x - centre.x) * scale),
    };
  }, [action, mixer, scene]);

  /* --------------------------------------------------------------- *
   * Place the camera so that box always fits between the header and the
   * control bar, at any viewport size.
   * --------------------------------------------------------------- */
  useLayoutEffect(() => {
    const isNarrow = size.width < 900;
    const top = Math.min(SAFE_TOP_PX / size.height, 0.2);
    const bottom = Math.min(SAFE_BOTTOM_PX / size.height, 0.25);

    const target = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, isNarrow ? 0.82 : 0.66, isNarrow ? 0.72 : 0.86).normalize();

    const corners: THREE.Vector3[] = [];
    for (const x of [-fit.half.x, fit.half.x]) {
      for (const y of [-fit.half.y, fit.half.y]) {
        for (const z of [-fit.half.z, fit.half.z]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }

    camera.clearViewOffset();
    const distance = fitDistance(camera, corners, target, direction, MARGIN, 1 - top - bottom);

    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.near = Math.max(0.05, distance * 0.05);
    camera.far = distance * 6;
    // Slide the image up so the book is centred in the space the UI leaves.
    camera.setViewOffset(
      size.width,
      size.height,
      0,
      ((bottom - top) / 2) * size.height,
      size.width,
      size.height,
    );
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(target);
      controls.minDistance = distance * 0.55;
      controls.maxDistance = distance * 1.4;
      controls.update();
    }
  }, [camera, controls, fit, size.width, size.height]);

  /* --------------------------------------------------------------- *
   * Page turning.
   *
   * The action plays but is held paused, with its time driven by hand.
   * That preserves the skeleton's accumulated state -- leaves already
   * turned stay on the left -- and makes a backwards turn free.
   * --------------------------------------------------------------- */
  const turn = useRef({ time: STOPS[0], to: STOPS[0], rate: 1 });
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__bookScrub = (time: number) => {
      turn.current.time = time;
      turn.current.to = time;
    };
    return () => {
      delete scope.__bookScrub;
    };
  }, []);

  useEffect(() => {
    const target = STOPS[clampStop(stop)];
    const state = turn.current;
    state.to = target;
    state.rate = turnRate(state.time, stop);
    // A turn reversed before its first frame has nowhere to travel, so the
    // frame loop would never report it finished.
    if (state.time === target) onSettledRef.current();
  }, [stop]);

  /* --------------------------------------------------------------- *
   * Button hover + press.
   * --------------------------------------------------------------- */
  const hovered = useRef<SoundButton | null>(null);

  const setHovered = (next: SoundButton | null) => {
    if (hovered.current === next) return;
    for (const cap of hovered.current?.caps ?? []) {
      cap.emissive.set("#000000");
      cap.emissiveIntensity = 0;
    }
    hovered.current = next;
    for (const cap of next?.caps ?? []) {
      cap.emissive.set("#ffd27a");
      cap.emissiveIntensity = 0.22;
    }
    document.body.style.cursor = next ? "pointer" : "";
  };

  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  const buttonFrom = (event: ThreeEvent<PointerEvent>) => buttons.byObject.get(event.object) ?? null;

  // Dev-only: where each button sits on screen, so scripts can click them.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__bookButtonPoints = () => {
      const rect = gl.domElement.getBoundingClientRect();
      return buttons.list.map((button) => {
        const point = new THREE.Box3()
          .setFromObject(button.node)
          .getCenter(new THREE.Vector3())
          .project(camera);
        return {
          id: button.id,
          x: rect.left + ((point.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - point.y) / 2) * rect.height,
        };
      });
    };
    return () => {
      delete scope.__bookButtonPoints;
    };
  }, [buttons, camera, gl]);

  useFrame((_, delta) => {
    const state = turn.current;

    if (state.time !== state.to) {
      const direction = Math.sign(state.to - state.time);
      const next = state.time + direction * state.rate * Math.min(delta, 1 / 12);
      state.time = direction > 0 ? Math.min(next, state.to) : Math.max(next, state.to);
      if (state.time === state.to) onSettledRef.current();
    }

    if (action) action.time = state.time;
    mixer.update(delta);

    const now = performance.now();
    for (const button of buttons.list) {
      const held = now - button.pressedAt < PRESS_HOLD_MS;
      button.press += ((held ? 1 : 0) - button.press) * Math.min(1, delta * (held ? 40 : 14));
      button.node.position.y = button.restY - PRESS_DEPTH * button.press;
    }

    if (root.current) {
      root.current.position.x = -centreAt(state.time, fit.centres);
    }
  });

  return (
    <>
      <group ref={root} scale={fit.scale}>
        <primitive
          object={scene}
          position={fit.offset}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            const button = buttonFrom(event);
            if (!button) return;
            event.stopPropagation();
            setHovered(button);
          }}
          onPointerOut={(event: ThreeEvent<PointerEvent>) => {
            if (buttonFrom(event) === hovered.current) setHovered(null);
          }}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            const button = buttonFrom(event);
            if (!button) return;
            event.stopPropagation();
            button.pressedAt = performance.now();
            onButton?.(button.id);
          }}
        />
      </group>
      <ContactShadows
        position={[0, fit.floor + 0.002, 0]}
        opacity={0.42}
        scale={BOOK_WIDTH * 2.6}
        blur={2.6}
        far={fit.half.y * 2.2}
        resolution={1024}
        color="#4a3a24"
      />
    </>
  );
}

/** A small studio built from area lights, so no HDRI has to be fetched. */
function Studio() {
  return (
    <Environment resolution={256}>
      <Lightformer form="rect" intensity={3.6} position={[0, 5, 3]} scale={[10, 5, 1]} target />
      <Lightformer form="rect" intensity={1.9} position={[-5, 2, 3]} scale={[5, 5, 1]} target />
      <Lightformer form="rect" intensity={1.4} position={[5, 1, -3]} scale={[5, 5, 1]} target />
      <Lightformer
        form="circle"
        intensity={2.4}
        color="#ffeed3"
        position={[0, 6, -3]}
        scale={6}
        target
      />
      <mesh scale={30}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#4a5560" side={THREE.BackSide} />
      </mesh>
    </Environment>
  );
}

export default function BookScene({
  stop,
  onSettled,
  onButton,
}: {
  stop: number;
  onSettled: () => void;
  onButton?: (id: SoundId) => void;
}) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, 2]}
      shadows="percentage"
      camera={{ fov: 30, near: 0.1, far: 60 }}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.02,
      }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight
        castShadow
        intensity={1.9}
        position={[3.5, 6.5, 4]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 24]} />
      </directionalLight>
      <directionalLight intensity={0.6} position={[-4, 3, -2]} color="#d3e2ff" />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        enablePan={false}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.15}
        minAzimuthAngle={-Math.PI / 3.2}
        maxAzimuthAngle={Math.PI / 3.2}
      />

      <Suspense fallback={null}>
        <BookModel stop={stop} onSettled={onSettled} onButton={onButton} />
        <Studio />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(MODEL_PATH);
