"use client";

/* eslint-disable react-hooks/immutability -- The three.js objects here
   (camera, mixer, animation action, materials, button nodes) are external
   mutable scene state. They are only changed in effects, pointer handlers
   and the frame loop, never during render, which is the model React Three
   Fiber is built around. */

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import PhotoSlot, { PHOTO_PAGE_MATERIAL, PHOTO_PAGE_TEXTURE, measurePhotoFrame } from "./PhotoSlot";
import { soundForTexture, unlockAudio, type SoundId } from "./sounds";
import { CLIP_NAME, CLIP_STOPS, MODEL_PATH, STOPS, poseAt, turnRateTo } from "./timeline";

/** The book is rescaled so its widest pose measures this across. */
const BOOK_WIDTH = 2.6;

/** Breathing room left around the book, as a fraction of the usable frame. */
const MARGIN = 1.06;

/**
 * How much of the book has to be cropped out of frame before one finger
 * stops orbiting and starts panning. A little above zero, so that easing
 * back to the fully zoomed-out view hands orbiting back rather than
 * leaving a sliver of pan that the tether immediately undoes.
 */
const PAN_TAKEOVER = 0.06;

/**
 * Screen space kept clear for the overlaid header and control bar, so the
 * book is framed in the area between them rather than underneath them.
 */
const SAFE_TOP_PX = 100;
/** Below the lg breakpoint the page hint sits under the header, not beside it. */
const SAFE_TOP_NARROW_PX = 156;
const SAFE_BOTTOM_PX = 190;

/** Materials that should read as paper rather than as a coated surface. */
const PAPER = new Set(["1", "2", "3", "4", "5", "6", "White"]);

/** Poses sampled when measuring how much room the animation needs. */
const POSE_SAMPLES = 15;

/** How far a sound button travels when pressed, in model units (metres). */
const PRESS_DEPTH = 0.0024;
const PRESS_HOLD_MS = 130;

/**
 * The keepsake photo is shown once the last page's card has swung this far
 * through its opening turn, far enough to have cleared the pocket beneath.
 */
const PHOTO_REVEAL_TIME = THREE.MathUtils.lerp(
  CLIP_STOPS[CLIP_STOPS.length - 2],
  CLIP_STOPS[CLIP_STOPS.length - 1],
  0.45,
);

/** Where the book should sit horizontally at a clip time, eased between stops. */
function centreAt(time: number, centres: readonly number[]) {
  if (time <= CLIP_STOPS[0]) return centres[0];
  for (let i = 0; i < CLIP_STOPS.length - 1; i++) {
    if (time <= CLIP_STOPS[i + 1]) {
      const t = (time - CLIP_STOPS[i]) / (CLIP_STOPS[i + 1] - CLIP_STOPS[i]);
      return THREE.MathUtils.lerp(centres[i], centres[i + 1], t * t * (3 - 2 * t));
    }
  }
  return centres[centres.length - 1];
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TIP = new THREE.Quaternion();

type SoundButton = {
  id: SoundId;
  node: THREE.Object3D;
  caps: THREE.MeshStandardMaterial[];
  restY: number;
  pressedAt: number;
  press: number;
};

export type BookSceneTextures = {
  coverUrl?: string;
  pageUrls?: readonly string[];
  buttonIcons?: Partial<Record<SoundId, string>>;
};

/**
 * Timeline seconds for each stop the reader can land on, indexed by stop.
 *
 * The demo book uses the model's own stops, which include the keepsake pocket
 * before the final turn-over. A custom book has no pocket, so it passes its
 * own list -- cover, one entry per printed spread, then the turn-over -- and
 * the pocket is skipped rather than showing as a blank stop at the end.
 */
export type StopTimes = readonly number[];

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
  photo,
  onPhotoChange,
  photoControls,
  textures,
  stopTimes,
}: {
  stop: number;
  onSettled: () => void;
  onButton?: (id: SoundId) => void;
  photo: string | null;
  onPhotoChange: (photo: string | null) => boolean;
  photoControls: boolean;
  textures?: BookSceneTextures;
  stopTimes?: StopTimes;
}) {
  const root = useRef<THREE.Group>(null);
  const gltf = useGLTF(MODEL_PATH);
  const animations = gltf.animations;
  const scene = useMemo(() => {
    const clone = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
    });
    return clone;
  }, [gltf.scene]);
  const gl = useThree((state) => state.gl);
  const stage = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & {
        target: THREE.Vector3;
        update: () => void;
        minDistance: number;
        maxDistance: number;
        touches: { ONE: THREE.TOUCH; TWO: THREE.TOUCH };
      })
    | null;

  /** Where the fit put the camera, which the pan clamp measures strays against. */
  const home = useRef<{ target: THREE.Vector3; distance: number } | null>(null);

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
      if (!mesh.isMesh || mesh.userData.keepsake) return;

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
          // Matte paper: a glossy sheen over the print is what washes it out.
          standard.metalness = 0;
          standard.roughness = 0.82;
          const physical = standard as THREE.MeshPhysicalMaterial;
          if (physical.isMeshPhysicalMaterial) physical.specularIntensity = 0.4;
        } else {
          standard.metalness = Math.min(standard.metalness, 0.28);
          standard.roughness = Math.max(standard.roughness, 0.3);
        }

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

  useEffect(() => {
    if (!textures) return;

    const materialUrls = new Map<string, string>();
    if (textures.coverUrl) materialUrls.set("Cover", textures.coverUrl);
    for (const [index, url] of (textures.pageUrls ?? []).entries()) {
      if (url) materialUrls.set(String(index + 1), url);
    }

    const buttonIconUrls = textures.buttonIcons ?? {};
    if (materialUrls.size === 0 && Object.keys(buttonIconUrls).length === 0) return;

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const loaded: THREE.Texture[] = [];
    const anisotropy = gl.capabilities.getMaxAnisotropy();

    const applyTexture = (material: THREE.MeshStandardMaterial, url: string) => {
      loader.load(url, (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.anisotropy = anisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        loaded.push(texture);
        material.map = texture;
        material.color.set("#ffffff");
        material.needsUpdate = true;
      });
    };

    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) continue;
        const url = materialUrls.get(standard.name);
        if (url) applyTexture(standard, url);
      }
    });

    for (const button of buttons.list) {
      const url = buttonIconUrls[button.id];
      if (!url) continue;
      for (const cap of button.caps) applyTexture(cap, url);
    }

    return () => {
      cancelled = true;
      for (const texture of loaded) texture.dispose();
    };
  }, [buttons, gl, scene, textures]);

  const action = useMemo(() => {
    const clip = animations.find((candidate) => candidate.name === CLIP_NAME) ?? animations[0];
    if (!clip) return null;

    const next = mixer.clipAction(clip);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.play();
    next.paused = true; // the time is driven by hand, in useFrame
    next.time = CLIP_STOPS[0];
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
    const duration = CLIP_STOPS[CLIP_STOPS.length - 1];
    const restore = action?.time ?? 0;

    const sample = (time: number, box: THREE.Box3) => {
      if (action) action.time = time;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      expandByPose(box, scene, 2);
    };

    // Where the book comes to rest ...
    const restingCentres: number[] = [];
    for (const time of CLIP_STOPS) {
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
    const top = Math.min((size.width < 1024 ? SAFE_TOP_NARROW_PX : SAFE_TOP_PX) / size.height, 0.24);
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
    home.current = { target, distance };
  }, [camera, controls, fit, home, size.width, size.height]);

  /* --------------------------------------------------------------- *
   * Panning has to reach the far edge of a zoomed-in spread without
   * letting the book be flung off screen, so the target is tethered:
   * it may stray by as much of the book as the frame has cropped away,
   * which is nothing at all once the whole book is back in view.
   * --------------------------------------------------------------- */
  useFrame(() => {
    if (!controls) return;
    const base = home.current;
    if (!base) return;

    const cropped = Math.max(0, 1 - camera.position.distanceTo(controls.target) / base.distance);

    /*
     * With the whole book in view the clamp below allows no stray at all, so
     * a one-finger pan would rein straight back and read as a dead model.
     * There, one finger orbits instead -- the desktop left-drag gesture --
     * and only hands over to panning once zooming has cropped enough of the
     * spread away for sliding across to the far page to be the useful drag.
     * The switch is deliberately not applied mid-gesture: OrbitControls
     * latches its handler on touchstart, so flipping this while a finger is
     * down cannot strand a drag halfway.
     */
    const wantsPan = cropped > PAN_TAKEOVER;
    const oneFinger = wantsPan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    if (controls.touches.ONE !== oneFinger) {
      controls.touches = { ONE: oneFinger, TWO: THREE.TOUCH.DOLLY_ROTATE };
    }

    const slack = new THREE.Vector3(fit.half.x, fit.half.y, fit.half.z).multiplyScalar(cropped);
    const strayed = controls.target.clone().sub(base.target);

    const reined = new THREE.Vector3(
      THREE.MathUtils.clamp(strayed.x, -slack.x, slack.x),
      THREE.MathUtils.clamp(strayed.y, -slack.y, slack.y),
      THREE.MathUtils.clamp(strayed.z, -slack.z, slack.z),
    );
    if (reined.equals(strayed)) return;

    // Carry the camera along, so reining in the target slides rather than swivels.
    const correction = reined.sub(strayed);
    controls.target.add(correction);
    camera.position.add(correction);
  });

  /* --------------------------------------------------------------- *
   * Page turning.
   *
   * The action plays but is held paused, with its time driven by hand.
   * That preserves the skeleton's accumulated state -- leaves already
   * turned stay on the left -- and makes a backwards turn free.
   * --------------------------------------------------------------- */
  const turn = useRef({ time: STOPS[0], to: STOPS[0], rate: 1 });

  /** The leaf carrying the photo pocket; the photo is parented to it. */
  /*
   * The leaf carrying the pocket, found by the material it is printed with.
   *
   * Matching on the material's *name* rather than its texture's name matters:
   * a custom book replaces that texture with the reader's own page artwork, so
   * a lookup keyed on the shipped texture name would depend on running before
   * the upload finishes loading.
   */
  const pocket = useMemo(() => {
    let found: THREE.Object3D | null = null;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (found || !mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const onPage = materials.some((material) => {
        const standard = material as THREE.MeshStandardMaterial;
        return standard.name === PHOTO_PAGE_MATERIAL || standard.map?.name === PHOTO_PAGE_TEXTURE;
      });
      if (onPage) found = mesh;
    });
    return found as THREE.Object3D | null;
  }, [scene]);

  const isPhotoRevealed = useCallback(() => poseAt(turn.current.time).clip >= PHOTO_REVEAL_TIME, []);

  /**
   * Measure the pocket once, from the second-to-last stop, where the white
   * card still lies flat over it. Nothing but the card moves after that, so
   * the measurement holds for the last page.
   */
  const photoFrame = useMemo(() => {
    const mesh = pocket as THREE.SkinnedMesh | null;
    if (!mesh?.isSkinnedMesh || !action) return null;

    const restore = action.time;
    action.time = CLIP_STOPS[CLIP_STOPS.length - 2];
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const frame = measurePhotoFrame(mesh);

    action.time = restore;
    mixer.update(0);
    return frame;
  }, [action, mixer, pocket, scene]);
  const onSettledRef = useRef(onSettled);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  // Dev-only: renderer and scene handles, for checking colour and lighting.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__bookThree = { gl, scene: stage };
    return () => {
      delete scope.__bookThree;
    };
  }, [gl, stage]);

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
    const times = stopTimes ?? STOPS;
    const index = Math.min(Math.max(stop, 0), times.length - 1);
    const target = times[index];
    const state = turn.current;
    state.to = target;
    // `turnRate` measures the trip in authored page-turns, so it works off the
    // timeline positions rather than the stop index either book counts in.
    state.rate = turnRateTo(state.time, target);
    // A turn reversed before its first frame has nowhere to travel, so the
    // frame loop would never report it finished.
    if (state.time === target) onSettledRef.current();
  }, [stop, stopTimes]);

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

  // Once the book is turned over its sound module faces the table, so the buttons stop responding.
  const buttonFrom = (event: ThreeEvent<PointerEvent>) =>
    poseAt(turn.current.time).flip > 0.02 ? null : (buttons.byObject.get(event.object) ?? null);

  /**
   * iOS Safari only unlocks Web Audio from a real DOM gesture, and it does not
   * count the synthetic events react-three-fiber raises from its raycaster. A
   * native listener on the canvas therefore unlocks the context first, before
   * the press is resolved to a button.
   */
  useEffect(() => {
    const canvas = gl.domElement;
    const unlock = () => unlockAudio();
    canvas.addEventListener("pointerdown", unlock);
    canvas.addEventListener("touchstart", unlock, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", unlock);
      canvas.removeEventListener("touchstart", unlock);
    };
  }, [gl]);

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

    const pose = poseAt(state.time);
    if (action) action.time = pose.clip;
    mixer.update(delta);

    const now = performance.now();
    for (const button of buttons.list) {
      const held = now - button.pressedAt < PRESS_HOLD_MS;
      button.press += ((held ? 1 : 0) - button.press) * Math.min(1, delta * (held ? 40 : 14));
      button.node.position.y = button.restY - PRESS_DEPTH * button.press;
    }

    if (root.current) {
      // Turning the book over: tip it towards the reader while spinning it
      // round. Ry(pi) * Rx(pi) equals Rz(pi), so it lands face down with the
      // back cover reading the right way up, without ever standing on its
      // long edge and leaving the frame.
      const angle = Math.PI * pose.flip;
      root.current.quaternion
        .setFromAxisAngle(Y_AXIS, angle)
        .multiply(TIP.setFromAxisAngle(X_AXIS, angle));
      // Keep the book centred as the spin carries its offset round.
      root.current.position.x = -centreAt(pose.clip, fit.centres) * Math.cos(angle);
      // Draw it back a little mid-turn, the way a book is lifted to turn it
      // over, so the tipped-up book stays inside the frame.
      root.current.scale.setScalar(fit.scale * (1 - 0.22 * Math.sin(angle)));
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
      {pocket &&
        photoFrame &&
        createPortal(
          <PhotoSlot
            frame={photoFrame}
            photo={photo}
            showControls={photoControls}
            isRevealed={isPhotoRevealed}
            onChange={onPhotoChange}
          />,
          pocket,
        )}
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

/*
 * Lighting is balanced so the page artwork, and any photo placed in the
 * book, render at their true colours. Under ACES filmic tone mapping and
 * brighter lights, a test photo lost half its saturation (mean colour error
 * 128 out of 441). These values were picked by measuring that same photo on
 * screen across a sweep of light levels, and bring the error down to about 13.
 */
const ENVIRONMENT_INTENSITY = 0.7;
const KEY_LIGHT = 0.5;
const FILL_LIGHT = 0.2;

/** A small studio built from area lights, so no HDRI has to be fetched. */
function Studio() {
  return (
    <Environment resolution={256} environmentIntensity={ENVIRONMENT_INTENSITY}>
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
  photo,
  onPhotoChange,
  photoControls,
  textures,
  stopTimes,
}: {
  stop: number;
  onSettled: () => void;
  onButton?: (id: SoundId) => void;
  photo?: string | null;
  onPhotoChange?: (photo: string | null) => boolean;
  photoControls?: boolean;
  textures?: BookSceneTextures;
  stopTimes?: StopTimes;
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
        // Neutral keeps printed colours true; ACES filmic desaturates them.
        toneMapping: THREE.NeutralToneMapping,
        toneMappingExposure: 1,
      }}
    >
      <directionalLight
        castShadow
        intensity={KEY_LIGHT}
        position={[3.5, 6.5, 4]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 24]} />
      </directionalLight>
      <directionalLight intensity={FILL_LIGHT} position={[-4, 3, -2]} color="#d3e2ff" />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        /*
         * One finger orbits while the whole book is in view, and becomes a
         * pan once zooming crops the spread wider than the screen, so that
         * sliding across to read the far page stays a one-finger gesture.
         * `BookModel`'s tether frame owns that swap, since it already
         * measures how much of the book the frame has cropped away; the
         * value set here is only the starting, fully-zoomed-out binding.
         */
        screenSpacePanning={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.15}
        minAzimuthAngle={-Math.PI / 3.2}
        maxAzimuthAngle={Math.PI / 3.2}
      />

      <Suspense fallback={null}>
        <BookModel
          stop={stop}
          onSettled={onSettled}
          onButton={onButton}
          photo={photo ?? null}
          onPhotoChange={onPhotoChange ?? (() => false)}
          photoControls={photoControls ?? false}
          textures={textures}
          stopTimes={stopTimes}
        />
        <Studio />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(MODEL_PATH);
