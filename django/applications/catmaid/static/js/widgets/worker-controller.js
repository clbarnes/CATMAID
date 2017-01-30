/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

  "use strict";

  var WORKER_ROOT = document.location.origin + '/static/js/workers/';

  var MAX_WORKERS = 3;

  var getWorkerUrl = function(workerName) {
    return WORKER_ROOT + workerName + '.js';
  };

  var AVAILABLE_WORKERS = new Map([
    ['Prime Worker', getWorkerUrl('prime-worker')]
  ]);

  var DEFAULT_WORKER = 'Prime Worker';

  var WorkerController = function()
  {
    this.widgetID = this.registerInstance();
    this.idPrefix = `worker-controller${this.widgetID}-`;

    this.workers = [];
  };

  WorkerController.prototype = {};
  $.extend(WorkerController.prototype, new InstanceRegistry());

  WorkerController.prototype.getName = function() {
    return "Worker Controller " + this.widgetID;
  };

  WorkerController.prototype.destroy = function() {
    this.unregisterInstance();
  };

  WorkerController.prototype.getWidgetConfiguration = function() {
    var WCobject = this;
    return {
      helpText: "Connector Viewer widget: Quickly view and compare connectors associated with given skeletons",
      controlsID: this.idPrefix + 'controls',
      createControls: function(controls) {
        var workerSelect = CATMAID.DOM.createSelect(
          WCobject.idPrefix + 'worker-select',
          Array.from(AVAILABLE_WORKERS.entries()).map(function (keyVal) {
            return {title: keyVal[0], value: keyVal[1]};
          }),
          AVAILABLE_WORKERS.get(DEFAULT_WORKER)
        );
        controls.appendChild(workerSelect);

        var addWorker = document.createElement('input');
        addWorker.setAttribute('type', 'button');
        addWorker.setAttribute('value', 'Add worker');
        addWorker.onclick = WCobject.createNewWorker.bind(WCobject);

        controls.appendChild(addWorker);

        var terminateWorkers = document.createElement('input');
        terminateWorkers.setAttribute('type', 'button');
        terminateWorkers.setAttribute('value', 'Terminate all workers');
        terminateWorkers.onclick = function () {
          for (var worker of WCobject.workers) {
            worker.terminate();
          }
          WCobject.workers.length = 0;
        };

        controls.appendChild(terminateWorkers);
      },
      contentID: this.idPrefix + 'content',
      createContent: function(container) {
        container.innerHTML = `
          <style type="text/css">
          .tg  {border-collapse:collapse;border-spacing:0;}
          .tg td{font-family:Arial, sans-serif;font-size:14px;padding:10px 5px;border-style:solid;border-width:1px;overflow:hidden;word-break:normal;}
          .tg th{font-family:Arial, sans-serif;font-size:14px;font-weight:normal;padding:10px 5px;border-style:solid;border-width:1px;overflow:hidden;word-break:normal;}
          .tg .tg-yw4l{vertical-align:top}
          </style>
          <table id="${WCobject.idPrefix}-table" class="tg">
            <tr>
              <th class="tg-yw4l">Worker name</th>
              <th class="tg-yw4l">Total runtime</th>
              <th class="tg-yw4l">Last runtime</th>
              <th class="tg-yw4l">Result</th>
            </tr>
            <tr>
              <td class="tg-yw4l worker0 worker-name">Not created</td>
              <td class="tg-yw4l worker0 worker-total-runtime">0</td>
              <td class="tg-yw4l worker0 worker-last-runtime">0</td>
              <td class="tg-yw4l worker0 worker-result">n/a</td>
            </tr>
            <tr>
              <td class="tg-yw4l worker1 worker-name">Not created</td>
              <td class="tg-yw4l worker1 worker-total-runtime">0</td>
              <td class="tg-yw4l worker1 worker-last-runtime">0</td>
              <td class="tg-yw4l worker1 worker-result">n/a</td>
            </tr>
            <tr>
              <td class="tg-yw4l worker2 worker-name">Not created</td>
              <td class="tg-yw4l worker2 worker-total-runtime">0</td>
              <td class="tg-yw4l worker2 worker-last-runtime">0</td>
              <td class="tg-yw4l worker2 worker-result">n/a</td>
            </tr>
          </table>
        `;
      },
      init: function() {
      }
    };
  };

  WorkerController.prototype.getSelectedWorker = function() {
    var elt = document.getElementById(this.idPrefix + 'worker-select');

    if (elt.selectedIndex == -1)
        return null;

    var selectedOption = elt.options[elt.selectedIndex];

    return {title: selectedOption.text, value: selectedOption.value};
  };


  WorkerController.prototype.createNewWorker = function() {
    if (this.workers.length >= MAX_WORKERS) {
      alert('Too many workers already! Please delete some.');
    } else {
      var selectedWorkerInfo = this.getSelectedWorker();

      var workerIdx = this.workers.length;

      var worker = new Worker(selectedWorkerInfo.value);

      document.getElementsByClassName('worker' + workerIdx + ' worker-name')[0].innerText = selectedWorkerInfo.title;

      worker.addEventListener('message', function (e) {
        var totalRuntime = document.getElementsByClassName('worker' + e.data.idx + ' worker-total-runtime')[0];
        totalRuntime.innerText = Number(totalRuntime.innerText) + e.data.runtime;

        var thisRuntime = document.getElementsByClassName('worker' + e.data.idx + ' worker-last-runtime')[0];
        thisRuntime.innerText = e.data.runtime;

        var thisResult = document.getElementsByClassName('worker' + e.data.idx + ' worker-result')[0];
        thisResult.innerText = e.data.output;
      }, false);


      worker.postMessage({cmd: 'start', idx: workerIdx, startAt: 1});
      this.workers.push(worker);
    }
  };


  // Export widget
  CATMAID.WorkerController = WorkerController;

  // Register widget with CATMAID
  CATMAID.registerWidget({
    key: 'worker-controller',
    creator: WorkerController
  });


})(CATMAID);
