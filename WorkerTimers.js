var WorkerTimers = (function (exports) {
    'use strict';

    const createCache = (lastNumberWeakMap) => {
        return (collection, nextNumber) => {
            lastNumberWeakMap.set(collection, nextNumber);
            return nextNumber;
        };
    };

    /*
     * The value of the constant Number.MAX_SAFE_INTEGER equals (2 ** 53 - 1) but it
     * is fairly new.
     */
    const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER === undefined ? 9007199254740991 : Number.MAX_SAFE_INTEGER;
    const TWO_TO_THE_POWER_OF_TWENTY_NINE = 536870912;
    const TWO_TO_THE_POWER_OF_THIRTY = TWO_TO_THE_POWER_OF_TWENTY_NINE * 2;
    const createGenerateUniqueNumber = (cache, lastNumberWeakMap) => {
        return (collection) => {
            const lastNumber = lastNumberWeakMap.get(collection);
            /*
             * Let's try the cheapest algorithm first. It might fail to produce a new
             * number, but it is so cheap that it is okay to take the risk. Just
             * increase the last number by one or reset it to 0 if we reached the upper
             * bound of SMIs (which stands for small integers). When the last number is
             * unknown it is assumed that the collection contains zero based consecutive
             * numbers.
             */
            let nextNumber = lastNumber === undefined ? collection.size : lastNumber < TWO_TO_THE_POWER_OF_THIRTY ? lastNumber + 1 : 0;
            if (!collection.has(nextNumber)) {
                return cache(collection, nextNumber);
            }
            /*
             * If there are less than half of 2 ** 30 numbers stored in the collection,
             * the chance to generate a new random number in the range from 0 to 2 ** 30
             * is at least 50%. It's benifitial to use only SMIs because they perform
             * much better in any environment based on V8.
             */
            if (collection.size < TWO_TO_THE_POWER_OF_TWENTY_NINE) {
                while (collection.has(nextNumber)) {
                    nextNumber = Math.floor(Math.random() * TWO_TO_THE_POWER_OF_THIRTY);
                }
                return cache(collection, nextNumber);
            }
            // Quickly check if there is a theoretical chance to generate a new number.
            if (collection.size > MAX_SAFE_INTEGER) {
                throw new Error('Congratulations, you created a collection of unique numbers which uses all available integers!');
            }
            // Otherwise use the full scale of safely usable integers.
            while (collection.has(nextNumber)) {
                nextNumber = Math.floor(Math.random() * MAX_SAFE_INTEGER);
            }
            return cache(collection, nextNumber);
        };
    };

    const LAST_NUMBER_WEAK_MAP = new WeakMap();
    const cache = createCache(LAST_NUMBER_WEAK_MAP);
    const generateUniqueNumber = createGenerateUniqueNumber(cache, LAST_NUMBER_WEAK_MAP);

    const isMessagePort = (sender) => {
        return typeof sender.start === 'function';
    };

    const PORT_MAP = new WeakMap();

    const extendBrokerImplementation = (partialBrokerImplementation) => ({
        ...partialBrokerImplementation,
        connect: ({ call }) => {
            return async () => {
                const { port1, port2 } = new MessageChannel();
                const portId = await call('connect', { port: port1 }, [port1]);
                PORT_MAP.set(port2, portId);
                return port2;
            };
        },
        disconnect: ({ call }) => {
            return async (port) => {
                const portId = PORT_MAP.get(port);
                if (portId === undefined) {
                    throw new Error('The given port is not connected.');
                }
                await call('disconnect', { portId });
            };
        },
        isSupported: ({ call }) => {
            return () => call('isSupported');
        }
    });

    const ONGOING_REQUESTS = new WeakMap();
    const createOrGetOngoingRequests = (sender) => {
        if (ONGOING_REQUESTS.has(sender)) {
            // @todo TypeScript needs to be convinced that has() works as expected.
            return ONGOING_REQUESTS.get(sender);
        }
        const ongoingRequests = new Map();
        ONGOING_REQUESTS.set(sender, ongoingRequests);
        return ongoingRequests;
    };
    const createBroker = (brokerImplementation) => {
        const fullBrokerImplementation = extendBrokerImplementation(brokerImplementation);
        return (sender) => {
            const ongoingRequests = createOrGetOngoingRequests(sender);
            sender.addEventListener('message', (({ data: message }) => {
                const { id } = message;
                if (id !== null && ongoingRequests.has(id)) {
                    const { reject, resolve } = ongoingRequests.get(id);
                    ongoingRequests.delete(id);
                    if (message.error === undefined) {
                        resolve(message.result);
                    }
                    else {
                        reject(new Error(message.error.message));
                    }
                }
            }));
            if (isMessagePort(sender)) {
                sender.start();
            }
            const call = (method, params = null, transferables = []) => {
                return new Promise((resolve, reject) => {
                    const id = generateUniqueNumber(ongoingRequests);
                    ongoingRequests.set(id, { reject, resolve });
                    if (params === null) {
                        sender.postMessage({ id, method }, transferables);
                    }
                    else {
                        sender.postMessage({ id, method, params }, transferables);
                    }
                });
            };
            const notify = (method, params, transferables = []) => {
                sender.postMessage({ id: null, method, params }, transferables);
            };
            let functions = {};
            for (const [key, handler] of Object.entries(fullBrokerImplementation)) {
                functions = { ...functions, [key]: handler({ call, notify }) };
            }
            return { ...functions };
        };
    };

    // Prefilling the Maps with a function indexed by zero is necessary to be compliant with the specification.
    const scheduledIntervalsState = new Map([[0, null]]); // tslint:disable-line no-empty
    const scheduledTimeoutsState = new Map([[0, null]]); // tslint:disable-line no-empty
    const wrap = createBroker({
        clearInterval: ({ call }) => {
            return (timerId) => {
                if (typeof scheduledIntervalsState.get(timerId) === 'symbol') {
                    scheduledIntervalsState.set(timerId, null);
                    call('clear', { timerId, timerType: 'interval' }).then(() => {
                        scheduledIntervalsState.delete(timerId);
                    });
                }
            };
        },
        clearTimeout: ({ call }) => {
            return (timerId) => {
                if (typeof scheduledTimeoutsState.get(timerId) === 'symbol') {
                    scheduledTimeoutsState.set(timerId, null);
                    call('clear', { timerId, timerType: 'timeout' }).then(() => {
                        scheduledTimeoutsState.delete(timerId);
                    });
                }
            };
        },
        setInterval: ({ call }) => {
            return (func, delay = 0, ...args) => {
                const symbol = Symbol();
                const timerId = generateUniqueNumber(scheduledIntervalsState);
                scheduledIntervalsState.set(timerId, symbol);
                const schedule = () => call('set', {
                    delay,
                    now: performance.timeOrigin + performance.now(),
                    timerId,
                    timerType: 'interval'
                }).then(() => {
                    const state = scheduledIntervalsState.get(timerId);
                    if (state === undefined) {
                        throw new Error('The timer is in an undefined state.');
                    }
                    if (state === symbol) {
                        func(...args);
                        // Doublecheck if the interval should still be rescheduled because it could have been cleared inside of func().
                        if (scheduledIntervalsState.get(timerId) === symbol) {
                            schedule();
                        }
                    }
                });
                schedule();
                return timerId;
            };
        },
        setTimeout: ({ call }) => {
            return (func, delay = 0, ...args) => {
                const symbol = Symbol();
                const timerId = generateUniqueNumber(scheduledTimeoutsState);
                scheduledTimeoutsState.set(timerId, symbol);
                call('set', {
                    delay,
                    now: performance.timeOrigin + performance.now(),
                    timerId,
                    timerType: 'timeout'
                }).then(() => {
                    const state = scheduledTimeoutsState.get(timerId);
                    if (state === undefined) {
                        throw new Error('The timer is in an undefined state.');
                    }
                    if (state === symbol) {
                        // A timeout can be savely deleted because it is only called once.
                        scheduledTimeoutsState.delete(timerId);
                        func(...args);
                    }
                });
                return timerId;
            };
        }
    });
    const load = (url) => {
        const worker = new Worker(url);
        return wrap(worker);
    };

    const createLoadOrReturnBroker = (loadBroker, worker) => {
        let broker = null;
        return () => {
            if (broker !== null) {
                return broker;
            }
            const blob = new Blob([worker], { type: 'application/javascript; charset=utf-8' });
            const url = URL.createObjectURL(blob);
            broker = loadBroker(url);
            // Bug #1: Edge up until v18 didn't like the URL to be revoked directly.
            setTimeout(() => URL.revokeObjectURL(url));
            return broker;
        };
    };

    // This is the minified and stringified code of the worker-timers-worker package.
    const worker = `(()=>{var e={455:function(e,t){!function(e){"use strict";var t=function(e){return function(t){var r=e(t);return t.add(r),r}},r=function(e){return function(t,r){return e.set(t,r),r}},n=void 0===Number.MAX_SAFE_INTEGER?9007199254740991:Number.MAX_SAFE_INTEGER,o=536870912,s=2*o,a=function(e,t){return function(r){var a=t.get(r),i=void 0===a?r.size:a<s?a+1:0;if(!r.has(i))return e(r,i);if(r.size<o){for(;r.has(i);)i=Math.floor(Math.random()*s);return e(r,i)}if(r.size>n)throw new Error("Congratulations, you created a collection of unique numbers which uses all available integers!");for(;r.has(i);)i=Math.floor(Math.random()*n);return e(r,i)}},i=new WeakMap,u=r(i),c=a(u,i),d=t(c);e.addUniqueNumber=d,e.generateUniqueNumber=c}(t)}},t={};function r(n){var o=t[n];if(void 0!==o)return o.exports;var s=t[n]={exports:{}};return e[n].call(s.exports,s,s.exports,r),s.exports}(()=>{"use strict";const e=-32603,t=-32602,n=-32601,o=(e,t)=>Object.assign(new Error(e),{status:t}),s=t=>o('The handler of the method called "'.concat(t,'" returned an unexpected result.'),e),a=(t,r)=>async({data:{id:a,method:i,params:u}})=>{const c=r[i];try{if(void 0===c)throw(e=>o('The requested method called "'.concat(e,'" is not supported.'),n))(i);const r=void 0===u?c():c(u);if(void 0===r)throw(t=>o('The handler of the method called "'.concat(t,'" returned no required result.'),e))(i);const d=r instanceof Promise?await r:r;if(null===a){if(void 0!==d.result)throw s(i)}else{if(void 0===d.result)throw s(i);const{result:e,transferables:r=[]}=d;t.postMessage({id:a,result:e},r)}}catch(e){const{message:r,status:n=-32603}=e;t.postMessage({error:{code:n,message:r},id:a})}};var i=r(455);const u=new Map,c=(e,r,n)=>({...r,connect:({port:t})=>{t.start();const n=e(t,r),o=(0,i.generateUniqueNumber)(u);return u.set(o,(()=>{n(),t.close(),u.delete(o)})),{result:o}},disconnect:({portId:e})=>{const r=u.get(e);if(void 0===r)throw(e=>o('The specified parameter called "portId" with the given value "'.concat(e,'" does not identify a port connected to this worker.'),t))(e);return r(),{result:null}},isSupported:async()=>{if(await new Promise((e=>{const t=new ArrayBuffer(0),{port1:r,port2:n}=new MessageChannel;r.onmessage=({data:t})=>e(null!==t),n.postMessage(t,[t])}))){const e=n();return{result:e instanceof Promise?await e:e}}return{result:!1}}}),d=(e,t,r=()=>!0)=>{const n=c(d,t,r),o=a(e,n);return e.addEventListener("message",o),()=>e.removeEventListener("message",o)},l=e=>t=>{const r=e.get(t);if(void 0===r)return Promise.resolve(!1);const[n,o]=r;return clearTimeout(n),e.delete(t),o(!1),Promise.resolve(!0)},f=(e,t,r)=>(n,o,s)=>{const{expected:a,remainingDelay:i}=e(n,o);return new Promise((e=>{t.set(s,[setTimeout(r,i,a,t,e,s),e])}))},m=(e,t)=>{const r=performance.now(),n=e+t-r-performance.timeOrigin;return{expected:r+n,remainingDelay:n}},p=(e,t,r,n)=>{const o=e-performance.now();o>0?t.set(n,[setTimeout(p,o,e,t,r,n),r]):(t.delete(n),r(!0))},h=new Map,v=l(h),w=new Map,g=l(w),M=f(m,h,p),y=f(m,w,p);d(self,{clear:async({timerId:e,timerType:t})=>({result:await("interval"===t?v(e):g(e))}),set:async({delay:e,now:t,timerId:r,timerType:n})=>({result:await("interval"===n?M:y)(e,t,r)})})})()})();`; // tslint:disable-line:max-line-length

    const loadOrReturnBroker = createLoadOrReturnBroker(load, worker);
    const clearInterval = (timerId) => loadOrReturnBroker().clearInterval(timerId);
    const clearTimeout = (timerId) => loadOrReturnBroker().clearTimeout(timerId);
    const setInterval = (...args) => loadOrReturnBroker().setInterval(...args);
    const setTimeout$1 = (...args) => loadOrReturnBroker().setTimeout(...args);

    exports.clearInterval = clearInterval;
    exports.clearTimeout = clearTimeout;
    exports.setInterval = setInterval;
    exports.setTimeout = setTimeout$1;

    return exports;

})({});
